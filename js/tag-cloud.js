(() => {
  const palette = [
    { text: '#b8cddd', textLight: '#405f78', border: 'rgba(102, 135, 163, .42)', bg: 'rgba(48, 68, 84, .62)', lightBg: 'rgba(228, 235, 240, .88)', glow: 'rgba(102, 135, 163, .18)' },
    { text: '#b4d0cb', textLight: '#3f6964', border: 'rgba(95, 143, 137, .42)', bg: 'rgba(43, 72, 68, .62)', lightBg: 'rgba(227, 237, 234, .88)', glow: 'rgba(95, 143, 137, .18)' },
    { text: '#cabfd2', textLight: '#665575', border: 'rgba(138, 120, 155, .42)', bg: 'rgba(67, 55, 78, .62)', lightBg: 'rgba(235, 230, 238, .88)', glow: 'rgba(138, 120, 155, .18)' },
    { text: '#d2c2b3', textLight: '#745d49', border: 'rgba(154, 128, 104, .42)', bg: 'rgba(78, 62, 48, .62)', lightBg: 'rgba(239, 233, 227, .88)', glow: 'rgba(154, 128, 104, .18)' },
    { text: '#b8c6db', textLight: '#465e7b', border: 'rgba(99, 127, 159, .42)', bg: 'rgba(47, 62, 81, .62)', lightBg: 'rgba(229, 233, 240, .88)', glow: 'rgba(99, 127, 159, .18)' },
    { text: '#bdcdbd', textLight: '#50694f', border: 'rgba(113, 139, 114, .42)', bg: 'rgba(53, 70, 54, .62)', lightBg: 'rgba(231, 237, 230, .88)', glow: 'rgba(113, 139, 114, .18)' }
  ]
  const svgNS = 'http://www.w3.org/2000/svg'
  const interactionRadius = 210
  const maxPushDistance = 22

  const resetInteraction = cloud => {
    cloud.classList.remove('has-active-node')
    cloud._tagLayout?.forEach(({ tag }) => {
      tag.classList.remove('is-active')
      tag.style.setProperty('--push-x', '0px')
      tag.style.setProperty('--push-y', '0px')
    })
  }

  const repelNearbyTags = (cloud, activeTag) => {
    const layout = cloud._tagLayout
    const active = layout?.find(item => item.tag === activeTag)
    if (!active) return

    cloud.classList.add('has-active-node')
    layout.forEach((item, index) => {
      const tag = item.tag
      if (tag === activeTag) {
        tag.classList.add('is-active')
        tag.style.setProperty('--push-x', '0px')
        tag.style.setProperty('--push-y', '0px')
        return
      }

      tag.classList.remove('is-active')
      let deltaX = item.centerX - active.centerX
      let deltaY = item.centerY - active.centerY
      let distance = Math.hypot(deltaX, deltaY)

      if (distance < 1) {
        const angle = index * Math.PI * (3 - Math.sqrt(5))
        deltaX = Math.cos(angle)
        deltaY = Math.sin(angle)
        distance = 1
      }

      const proximity = Math.max(0, 1 - distance / interactionRadius)
      const push = maxPushDistance * proximity * proximity
      tag.style.setProperty('--push-x', `${(deltaX / distance * push).toFixed(2)}px`)
      tag.style.setProperty('--push-y', `${(deltaY / distance * push).toFixed(2)}px`)
    })
  }

  const bindInteractions = cloud => {
    if (cloud.dataset.tagInteractionBound === 'true') return

    cloud.dataset.tagInteractionBound = 'true'
    cloud.addEventListener('pointerover', event => {
      const tag = event.target.closest('a')
      if (!tag || !cloud.contains(tag) || tag.contains(event.relatedTarget)) return
      repelNearbyTags(cloud, tag)
    })
    cloud.addEventListener('pointerout', event => {
      const tag = event.target.closest('a')
      if (!tag || tag.contains(event.relatedTarget)) return
      resetInteraction(cloud)
    })
  }

  const layoutTagCloud = () => {
    const cloud = document.querySelector('#page > .taxonomy-cloud-list')
    if (!cloud) return

    const tags = Array.from(cloud.querySelectorAll('a'))
    if (!tags.length) return
    const showNetworkLines = cloud.classList.contains('tag-cloud-list')

    const width = cloud.clientWidth
    const padding = 34
    const gap = 18
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    const sortedTags = tags
      .map((tag, originalIndex) => ({
        tag,
        originalIndex,
        count: Number(tag.dataset.count) || 1
      }))
      .sort((a, b) => b.count - a.count || a.originalIndex - b.originalIndex)
    const minCount = Math.min(...sortedTags.map(item => item.count))
    const maxCount = Math.max(...sortedTags.map(item => item.count))
    const countRange = Math.max(1, maxCount - minCount)

    sortedTags.forEach((item, index) => {
      const ratio = (item.count - minCount) / countRange
      const size = 0.86 + Math.pow(ratio, 0.62) * 1.42
      item.tag.style.fontSize = `${size.toFixed(3)}em`
      item.tag.style.zIndex = `${Math.max(1, 3 - Math.floor(index / 8))}`
    })

    const intersects = (box, occupied) => occupied.some(item =>
      box.left < item.right &&
      box.right > item.left &&
      box.top < item.bottom &&
      box.bottom > item.top
    )

    const createLayout = height => {
      const centerX = width / 2
      const centerY = height / 2
      const maxRadiusX = Math.max(1, Math.min(width * 0.36, width / 2 - padding))
      const maxRadiusY = Math.max(1, height / 2 - padding)
      const occupied = []
      const positions = []

      for (let index = 0; index < sortedTags.length; index++) {
        const item = sortedTags[index]
        const tagWidth = item.tag.offsetWidth
        const tagHeight = item.tag.offsetHeight
        const rankRatio = sortedTags.length > 1 ? index / (sortedTags.length - 1) : 0
        const radiusJitter = Math.sin(index * 1.83) * 0.035
        const targetRadius = Math.min(0.96, Math.max(0, Math.pow(rankRatio, 0.64) * 0.92 + radiusJitter))
        let placement

        for (let attempt = 0; attempt < 520; attempt++) {
          const ringOffset = attempt === 0 ? 0 : Math.ceil(attempt / 20) * 0.024
          const direction = attempt % 2 === 0 ? 1 : -1
          const radius = Math.min(1, Math.max(0, targetRadius + ringOffset * direction))
          const angle = index * goldenAngle + Math.sin(index * 2.17) * 0.4 + attempt * goldenAngle * 0.34
          const wobble = 1 + Math.sin(index * 1.71 + attempt * 0.43) * 0.07
          const x = centerX + Math.cos(angle) * maxRadiusX * radius * wobble - tagWidth / 2
          const y = centerY + Math.sin(angle) * maxRadiusY * radius * wobble - tagHeight / 2
          const box = {
            left: x - gap,
            right: x + tagWidth + gap,
            top: y - gap,
            bottom: y + tagHeight + gap
          }

          if (
            box.left >= padding / 2 &&
            box.right <= width - padding / 2 &&
            box.top >= padding / 2 &&
            box.bottom <= height - padding / 2 &&
            !intersects(box, occupied)
          ) {
            placement = {
              x,
              y,
              centerX: x + tagWidth / 2,
              centerY: y + tagHeight / 2,
              radius
            }
            occupied.push(box)
            break
          }
        }

        if (!placement) return null
        positions.push(placement)
      }

      return positions
    }

    let height = 980
    let positions
    while (!positions && height <= 1400) {
      positions = createLayout(height)
      if (!positions) height += 70
    }

    if (!positions) {
      height = Math.max(1400, sortedTags.length * 64)
      positions = sortedTags.map((item, index) => {
        const columns = Math.max(2, Math.floor(width / 180))
        const column = index % columns
        const row = Math.floor(index / columns)
        return {
          x: padding + column * ((width - padding * 2) / columns),
          y: padding + row * 64,
          centerX: padding + column * ((width - padding * 2) / columns) + item.tag.offsetWidth / 2,
          centerY: padding + row * 64 + item.tag.offsetHeight / 2,
          radius: index / sortedTags.length
        }
      })
    }

    cloud.style.height = `${height}px`

    let svg
    if (showNetworkLines) {
      svg = cloud.querySelector('.tag-network-lines')
      if (!svg) {
        svg = document.createElementNS(svgNS, 'svg')
        svg.classList.add('tag-network-lines')
        svg.setAttribute('aria-hidden', 'true')
        cloud.prepend(svg)
      }
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
      svg.replaceChildren()
    }

    const shouldAnimate = cloud.dataset.tagCloudReady !== 'true'
    resetInteraction(cloud)
    sortedTags.forEach((item, index) => {
      const tag = item.tag
      const position = positions[index]
      tag.style.left = `${position.x}px`
      tag.style.top = `${position.y}px`
      tag.style.setProperty('--push-x', '0px')
      tag.style.setProperty('--push-y', '0px')
      const color = palette[index % palette.length]
      tag.style.setProperty('--tag-text', color.text)
      tag.style.setProperty('--tag-text-light', color.textLight)
      tag.style.setProperty('--tag-text-light-hover', color.textLight)
      tag.style.setProperty('--tag-border', color.border)
      tag.style.setProperty('--tag-border-light', color.border)
      tag.style.setProperty('--tag-border-hover', color.border.replace('.42)', '.72)'))
      tag.style.setProperty('--tag-bg', color.bg)
      tag.style.setProperty('--tag-bg-hover', color.bg.replace('.62)', '.78)'))
      tag.style.setProperty('--tag-bg-light', color.lightBg)
      tag.style.setProperty('--tag-bg-light-hover', color.lightBg.replace('.88)', '.96)'))
      tag.style.setProperty('--tag-glow', color.glow)

      if (shouldAnimate) {
        tag.style.setProperty('--enter-x', `${(width / 2 - position.centerX).toFixed(2)}px`)
        tag.style.setProperty('--enter-y', `${(height / 2 - position.centerY).toFixed(2)}px`)
        tag.style.setProperty('--enter-delay', `${Math.min(360, index * 16)}ms`)
        tag.classList.add('is-entering')
        tag.addEventListener('animationend', () => tag.classList.remove('is-entering'), { once: true })
      }
    })

    if (showNetworkLines) {
      positions.forEach((point, index) => {
        const candidates = positions
          .map((other, otherIndex) => ({
            other,
            otherIndex,
            distance: Math.hypot(point.x - other.x, point.y - other.y)
          }))
          .filter(item =>
            item.otherIndex > index &&
            Math.abs(item.other.radius - point.radius) < 0.28
          )
          .sort((a, b) => a.distance - b.distance)
          .slice(0, index < 8 || index % 4 === 0 ? 2 : 1)

        candidates.forEach(({ other }) => {
          const line = document.createElementNS(svgNS, 'line')
          line.setAttribute('x1', point.centerX)
          line.setAttribute('y1', point.centerY)
          line.setAttribute('x2', other.centerX)
          line.setAttribute('y2', other.centerY)
          line.setAttribute('pathLength', '1')
          svg.appendChild(line)
        })
      })
    }

    cloud._tagLayout = sortedTags.map((item, index) => ({
      tag: item.tag,
      ...positions[index]
    }))
    bindInteractions(cloud)

    if (shouldAnimate) {
      cloud.dataset.tagCloudReady = 'true'
      cloud.classList.add('is-entering')
      window.setTimeout(() => cloud.classList.remove('is-entering'), 1100)
    }
  }

  let resizeFrame
  const requestLayout = () => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(layoutTagCloud)
  }

  window.addEventListener('load', requestLayout, { once: true })
  window.addEventListener('resize', requestLayout, { passive: true })
  window.addEventListener('pjax:complete', requestLayout)
})()
