(() => {
  const stylesheet = document.currentScript && document.currentScript.dataset.style
  if (window.postSort) {
    window.postSort.init(stylesheet)
    return
  }

  const cacheKey = 'post-sort:views:v1'
  const cacheTTL = 5 * 60 * 1000
  const requestTimeout = 10000
  let state = null

  const validCount = value => Number.isSafeInteger(value) && value >= 0
  const comparePath = (a, b) => a < b ? -1 : a > b ? 1 : 0
  const active = current => state === current && current.root.isConnected && location.pathname === current.path

  function readCache(urls) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey))
      const age = Date.now() - cached.time
      if (!Number.isFinite(cached.time) || !Number.isFinite(age) || age < 0 || age >= cacheTTL ||
          !Array.isArray(cached.urls) || !Array.isArray(cached.counts) ||
          cached.urls.length !== urls.length || cached.counts.length !== urls.length ||
          !urls.every((url, index) => cached.urls[index] === url && validCount(cached.counts[index]))) return null
      return new Map(urls.map((url, index) => [url, cached.counts[index]]))
    } catch (_) {
      return null
    }
  }

  function writeCache(urls, counts) {
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({
        time: Date.now(),
        urls,
        counts: urls.map(url => counts.get(url))
      }))
    } catch (_) {
      // Ranking also works when storage is unavailable or full.
    }
  }

  async function fetchCount(url, groupSignal) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    groupSignal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, requestTimeout)
    try {
      if (groupSignal.aborted) throw new Error('Ranking cancelled')
      const response = await fetch('https://events.vercount.one/api/v2/log?url=' + encodeURIComponent(url), {
        method: 'GET',
        credentials: 'omit',
        signal: controller.signal
      })
      if (!response.ok) throw new Error('Count request failed')
      const result = await response.json()
      if (result.status !== 'success' || !result.data || !validCount(result.data.page_pv)) {
        throw new Error('Count unavailable')
      }
      return result.data.page_pv
    } finally {
      clearTimeout(timer)
      groupSignal.removeEventListener('abort', abort)
    }
  }

  async function fetchCounts(urls, controller, progress) {
    const counts = new Map()
    let cursor = 0
    const worker = async () => {
      while (cursor < urls.length && !controller.signal.aborted) {
        const url = urls[cursor++]
        counts.set(url, await fetchCount(url, controller.signal))
        progress(counts.size)
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, urls.length) }, worker))
      if (controller.signal.aborted || counts.size !== urls.length) throw new Error('Ranking incomplete')
      return counts
    } catch (error) {
      controller.abort()
      throw error
    }
  }

  function pageUrl(number) {
    const url = new URL(location.href)
    url.searchParams.set('page', number)
    url.hash = 'content-inner'
    return url
  }

  function renderPage(current, focus = false) {
    if (!active(current) || !current.ranked) return
    const perPage = current.perPage || current.ranked.length || 1
    const total = Math.max(1, Math.ceil(current.ranked.length / perPage))
    const value = new URL(location.href).searchParams.get('page')
    const requested = value !== null && /^\d+$/.test(value) ? Number(value) : 1
    const number = Math.min(total, Math.max(1, Number.isSafeInteger(requested) ? requested : 1))
    if (value !== null && value !== String(number)) {
      const url = pageUrl(number)
      history.replaceState({ ...history.state, url: url.href }, '', url)
    }

    current.cards.forEach(card => card.remove())
    const fragment = document.createDocumentFragment()
    const start = (number - 1) * perPage
    current.ranked.slice(start, start + perPage).forEach((card, index) => {
      card.hidden = false
      card.classList.toggle('post-sort-first', index === 0)
      const cover = card.querySelector('.post_cover')
      if (cover && current.root.dataset.coverPosition === 'both') {
        cover.classList.toggle('left', index % 2 === 0)
        cover.classList.toggle('right', index % 2 !== 0)
      }
      fragment.appendChild(card)
    })
    current.root.insertBefore(fragment, current.pagination)

    const pages = document.createDocumentFragment()
    const addLink = (page, label, className = 'page-number') => {
      const link = document.createElement('a')
      link.href = pageUrl(page).href
      link.dataset.sortPage = page
      link.className = className
      link.textContent = label
      link.setAttribute('aria-label', className === 'page-number' ? '第 ' + page + ' 页' : label)
      pages.appendChild(link)
    }
    if (number > 1) addLink(number - 1, '上一页', 'extend prev')
    const visiblePages = [...new Set([1, number - 1, number, number + 1, total])]
      .filter(page => page >= 1 && page <= total).sort((a, b) => a - b)
    let previous = 0
    visiblePages.forEach(page => {
      if (previous && page > previous + 1) {
        const space = document.createElement('span')
        space.className = 'space'
        space.textContent = '…'
        pages.appendChild(space)
      }
      if (page === number) {
        const selected = document.createElement('span')
        selected.className = 'page-number current'
        selected.textContent = page
        selected.tabIndex = -1
        selected.setAttribute('aria-current', 'page')
        selected.setAttribute('aria-label', '第 ' + page + ' 页，共 ' + total + ' 页')
        pages.appendChild(selected)
      } else {
        addLink(page, String(page))
      }
      previous = page
    })
    if (number < total) addLink(number + 1, '下一页', 'extend next')
    current.pagination.querySelector('.pagination').replaceChildren(pages)
    current.pagination.hidden = total <= 1
    current.status.hidden = current.ranked.length > 0
    current.message.textContent = current.ranked.length ? '浏览排名已就绪。' : '暂无公开文章。'
    current.root.setAttribute('aria-busy', 'false')
    if (window.lazyLoadInstance) window.lazyLoadInstance.update()
    if (focus) {
      const selected = current.pagination.querySelector('[aria-current]')
      if (selected) selected.focus({ preventScroll: true })
      document.getElementById('content-inner').scrollIntoView()
    }
  }

  async function rank(current) {
    if (!active(current)) return
    if (current.controller) current.controller.abort()
    const controller = new AbortController()
    current.controller = controller
    current.retry.hidden = true
    current.status.hidden = false
    current.root.setAttribute('aria-busy', 'true')
    current.message.textContent = '正在读取全部文章的浏览次数，排名尚未完成…'
    try {
      const urls = [...new Set(current.cards.map(card => card.dataset.postUrl))].sort()
      urls.forEach(value => {
        const url = new URL(value)
        if (!['http:', 'https:'].includes(url.protocol) ||
            /^(localhost|127\.|\[::1\])/.test(url.hostname)) throw new Error('Invalid canonical URL')
      })
      let counts = readCache(urls)
      if (!counts) {
        counts = await fetchCounts(urls, controller, completed => {
          if (active(current) && current.controller === controller && !controller.signal.aborted) {
            current.message.textContent = '正在读取浏览次数（' + completed + '/' + urls.length + '），排名尚未完成…'
          }
        })
        if (!active(current) || current.controller !== controller) return
        writeCache(urls, counts)
      }
      if (!active(current) || controller.signal.aborted || current.controller !== controller) return
      current.ranked = current.cards.slice().sort((a, b) =>
        counts.get(b.dataset.postUrl) - counts.get(a.dataset.postUrl) ||
        Number(b.dataset.postDate) - Number(a.dataset.postDate) ||
        comparePath(a.dataset.postPath, b.dataset.postPath))
      current.ranked.forEach(card => {
        const count = card.querySelector('.post-sort-count')
        count.textContent = counts.get(card.dataset.postUrl).toLocaleString('zh-CN') + ' 次浏览'
        count.hidden = false
      })
      renderPage(current)
    } catch (_) {
      if (!active(current) || current.controller !== controller) return
      current.root.setAttribute('aria-busy', 'false')
      current.message.textContent = '未完成浏览排名：部分文章的浏览次数暂时无法获取，未显示不完整排名。请重试或返回最新发布。'
      current.retry.hidden = false
    }
  }

  function dispose() {
    if (state && state.controller) state.controller.abort()
    state = null
  }

  function init(styleUrl) {
    const root = document.querySelector('#recent-posts[data-post-sort]')
    if (!root || (state && state.root === root)) return
    dispose()
    if (!document.getElementById('post-sort-style') && styleUrl) {
      const link = document.createElement('link')
      link.id = 'post-sort-style'
      link.rel = 'stylesheet'
      link.href = styleUrl
      document.head.appendChild(link)
    }
    const current = { root, path: location.pathname, menu: root.querySelector('.post-sort-menu') }
    state = current
    if (root.dataset.postSort !== 'views') return
    current.cards = Array.from(root.querySelectorAll(':scope > .recent-post-item[data-post-url]'))
    current.perPage = Math.max(0, Math.floor(Number(root.dataset.sortPerPage) || 0))
    current.status = root.querySelector('.post-sort-status')
    current.message = root.querySelector('.post-sort-message')
    current.retry = root.querySelector('.post-sort-retry')
    current.pagination = root.querySelector('#pagination')
    current.retry.addEventListener('click', () => rank(current))
    current.pagination.addEventListener('click', event => {
      const link = event.target.closest('a[data-sort-page]')
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const url = pageUrl(Number(link.dataset.sortPage))
      history.pushState({ ...history.state, url: url.href }, '', url)
      renderPage(current, true)
    }, true)
    rank(current)
  }

  document.addEventListener('click', event => {
    if (state && state.menu && !state.menu.contains(event.target)) state.menu.open = false
  })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state && state.menu && state.menu.open) {
      state.menu.open = false
      state.menu.querySelector('summary').focus()
    }
  })
  window.addEventListener('popstate', event => {
    if (!state || !active(state) || state.root.dataset.postSort !== 'views') return
    // Same-route pagination belongs to this view, not PJAX's page fetcher.
    event.stopImmediatePropagation()
    renderPage(state)
  }, true)
  document.addEventListener('pjax:send', dispose)
  document.addEventListener('pjax:complete', () => init(stylesheet))
  window.postSort = { init }
  init(stylesheet)
})()
