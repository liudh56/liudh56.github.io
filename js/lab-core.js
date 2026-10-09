(function (root) {
    'use strict';

    const EPSILON = 1e-12;

    function assert(condition, message) {
        if (!condition) throw new Error(message);
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function particleToGrid(particles, nodeCount) {
        assert(Array.isArray(particles) && particles.length > 0, 'At least one particle is required.');
        assert(Number.isInteger(nodeCount) && nodeCount >= 2, 'nodeCount must be an integer greater than one.');

        const spacing = 1 / (nodeCount - 1);
        const nodes = Array.from({ length: nodeCount }, (_, index) => ({
            index,
            position: index * spacing,
            mass: 0,
            momentum: 0,
            velocity: 0,
            contributions: []
        }));

        particles.forEach((particle, particleIndex) => {
            const position = Number(particle.position);
            const mass = Number(particle.mass);
            const velocity = Number(particle.velocity);
            assert(Number.isFinite(position) && position >= 0 && position <= 1, 'Particle positions must be in [0, 1].');
            assert(Number.isFinite(mass) && mass > 0, 'Particle masses must be positive.');
            assert(Number.isFinite(velocity), 'Particle velocities must be finite.');

            let weightSum = 0;
            nodes.forEach(node => {
                const weight = Math.max(0, 1 - Math.abs(position - node.position) / spacing);
                if (weight <= EPSILON) return;
                const mappedMass = weight * mass;
                const mappedMomentum = mappedMass * velocity;
                node.mass += mappedMass;
                node.momentum += mappedMomentum;
                node.contributions.push({ particleIndex, weight, mappedMass, mappedMomentum });
                weightSum += weight;
            });
            assert(Math.abs(weightSum - 1) < 1e-9, 'Linear basis functions must form a partition of unity.');
        });

        nodes.forEach(node => {
            node.velocity = node.mass > EPSILON ? node.momentum / node.mass : 0;
        });

        const particleMass = particles.reduce((sum, particle) => sum + Number(particle.mass), 0);
        const particleMomentum = particles.reduce((sum, particle) => sum + Number(particle.mass) * Number(particle.velocity), 0);
        const gridMass = nodes.reduce((sum, node) => sum + node.mass, 0);
        const gridMomentum = nodes.reduce((sum, node) => sum + node.momentum, 0);

        return {
            spacing,
            nodes,
            totals: {
                particleMass,
                particleMomentum,
                gridMass,
                gridMomentum,
                massError: gridMass - particleMass,
                momentumError: gridMomentum - particleMomentum
            }
        };
    }

    function shapeStencil1D(position, nodeCount, basis = 'linear', particleHalfWidthRatio = 0.25) {
        assert(Number.isFinite(position) && position >= 0 && position <= 1, 'Position must be finite and in [0, 1].');
        assert(Number.isInteger(nodeCount) && nodeCount >= 3 && nodeCount <= 129, 'nodeCount must be an integer in [3, 129].');
        assert(basis === 'linear' || basis === 'quadratic' || basis === 'gimp', 'Basis must be linear, quadratic or gimp.');
        if (basis === 'gimp') {
            assert(Number.isFinite(particleHalfWidthRatio) && particleHalfWidthRatio > 0 && particleHalfWidthRatio <= 0.5,
                'particleHalfWidthRatio must be finite and in (0, 0.5].');
        }

        const inverseSpacing = nodeCount - 1;
        const spacing = 1 / inverseSpacing;
        const coordinate = position * inverseSpacing;
        if (basis === 'linear') {
            // Half-open cells select the right derivative at interior knots;
            // x = 1 uses the last cell's left derivative. Keep both endpoints,
            // including a zero weight with a nonzero spatial derivative.
            const left = position === 1 ? nodeCount - 2 : Math.floor(coordinate);
            const fraction = coordinate - left;
            return [
                { index: left, position: left * spacing, weight: 1 - fraction, gradient: -inverseSpacing },
                { index: left + 1, position: (left + 1) * spacing, weight: fraction, gradient: inverseSpacing }
            ];
        }

        const center = Math.floor(coordinate + 0.5);
        const stencil = [];
        if (basis === 'gimp') {
            // Exact normalized linear-hat average over [x - lp, x + lp],
            // lp = ratio * h. Its derivative is the hat endpoint difference
            // divided by 2 lp. The fixed domain is independent of volume.
            const ratio = particleHalfWidthRatio;
            for (let index = center - 1; index <= center + 1; index += 1) {
                const offset = coordinate - index;
                const distance = Math.abs(offset);
                const edgeOffset = distance - 1;
                let weight = 0;
                let gradient = 0;
                if (distance < ratio) {
                    weight = 1 - 0.5 * (ratio + distance * (distance / ratio));
                    gradient = -(offset / ratio) * inverseSpacing;
                } else if (edgeOffset <= -ratio) {
                    weight = 1 - distance;
                    gradient = -Math.sign(offset) * inverseSpacing;
                } else if (edgeOffset < ratio) {
                    // Subtract from the hat edge before adding the small
                    // domain width, retaining the limit even for tiny lp/h.
                    const remaining = ratio - edgeOffset;
                    const fraction = remaining / ratio;
                    weight = 0.25 * fraction * remaining;
                    gradient = -0.5 * Math.sign(offset) * fraction * inverseSpacing;
                }
                stencil.push({ index, position: index * spacing, weight, gradient });
            }
            // One exterior layer retains the complete averaged-hat support.
            return stencil;
        }
        for (let index = center - 1; index <= center + 1; index += 1) {
            const offset = coordinate - index;
            const distance = Math.abs(offset);
            let weight;
            let gradient;
            if (distance < 0.5) {
                weight = 0.75 - offset * offset;
                gradient = -2 * offset * inverseSpacing;
            } else {
                const remaining = 1.5 - distance;
                weight = 0.5 * remaining * remaining;
                gradient = -Math.sign(offset) * remaining * inverseSpacing;
            }
            stencil.push({ index, position: index * spacing, weight, gradient });
        }
        // Do not clip or renormalize boundary support: the exterior nodes
        // preserve sum(N) = 1, sum(x_i N_i) = x, and sum(dN/dx) = 0.
        return stencil;
    }

    function transferComparison2D(options = {}) {
        assert(options && typeof options === 'object' && !Array.isArray(options), 'Transfer comparison options must be an object.');
        const { preset = 'rotation', rounds = 1, inset = 0.25, affineInitialization = 'exact' } = options;
        assert(preset === 'translation' || preset === 'shear' || preset === 'rotation',
            'Preset must be translation, shear or rotation.');
        assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20, 'Rounds must be an integer in [1, 20].');
        assert(Number.isFinite(inset) && inset >= 0.1 && inset <= 0.4, 'Inset must be finite and in [0.1, 0.4].');
        assert(affineInitialization === 'exact' || affineInitialization === 'zero',
            'Affine initialization must be exact or zero.');

        // Fixed SI geometry: four 1 kg particles, four corner nodes, complete
        // bilinear support. A round is P2G/G2P, not a physical time step.
        const particlePositions = [[inset, inset], [1 - inset, inset],
            [inset, 1 - inset], [1 - inset, 1 - inset]];
        const nodePositions = [[0, 0], [1, 0], [0, 1], [1, 1]];
        const matrix = preset === 'rotation' ? [0, -1, 1, 0] :
            preset === 'shear' ? [0, 1, 0, 0] : [0, 0, 0, 0];
        const referenceVelocity = ([x, y]) => preset === 'translation' ? [1, -0.5] :
            [matrix[0] * (x - 0.5) + matrix[1] * (y - 0.5),
                matrix[2] * (x - 0.5) + matrix[3] * (y - 0.5)];
        const reference = {
            particles: particlePositions.map(referenceVelocity),
            nodes: nodePositions.map(referenceVelocity)
        };

        // Cache weights, offsets, masses and each particle's actual second
        // moment and inverse. The quadratic-kernel shortcut 4 I / h² is not
        // the inverse moment for these bilinear weights.
        const nodeMasses = [0, 0, 0, 0];
        const geometry = particlePositions.map(([x, y]) => {
            const D = [0, 0, 0, 0];
            const stencil = nodePositions.map(([nx, ny], index) => {
                const weight = (nx === 0 ? 1 - x : x) * (ny === 0 ? 1 - y : y);
                const dx = nx - x;
                const dy = ny - y;
                nodeMasses[index] += weight;
                D[0] += weight * dx * dx;
                D[1] += weight * dx * dy;
                D[2] += weight * dy * dx;
                D[3] += weight * dy * dy;
                return { weight, dx, dy };
            });
            const determinant = D[0] * D[3] - D[1] * D[2];
            const inverseD = [D[3] / determinant, -D[1] / determinant,
                -D[2] / determinant, D[0] / determinant];
            return { stencil, D, inverseD };
        });

        function snapshot(velocities, matrices, affine) {
            let orbital = 0;
            let affineAngular = 0;
            const momentum = [0, 0];
            for (let p = 0; p < 4; p += 1) {
                const [vx, vy] = velocities[p];
                orbital += (particlePositions[p][0] - 0.5) * vy - (particlePositions[p][1] - 0.5) * vx;
                momentum[0] += vx;
                momentum[1] += vy;
                if (affine) {
                    const C = matrices[p];
                    const D = geometry[p].D;
                    // B = C D; intrinsic angular momentum is m (B21 - B12).
                    affineAngular += C[2] * D[0] + C[3] * D[2] - C[0] * D[1] - C[1] * D[3];
                }
            }
            // No working arrays escape: later rounds cannot change snapshots.
            return {
                velocities: velocities.map(velocity => velocity.slice()),
                matrices: matrices.map(C => C.slice()),
                angular: { orbital, affine: affineAngular, total: orbital + affineAngular },
                momentum
            };
        }

        const referenceParticleNorm = Math.hypot(...reference.particles.flat());
        const referenceGridNorm = Math.hypot(...reference.nodes.flat());
        function relativeError(velocities, exact, norm) {
            let squaredError = 0;
            for (let p = 0; p < velocities.length; p += 1) {
                squaredError += (velocities[p][0] - exact[p][0]) ** 2 + (velocities[p][1] - exact[p][1]) ** 2;
            }
            return Math.sqrt(squaredError) / norm;
        }

        const methods = ['pic', 'flip', 'apic'].map(method => {
            const affine = method === 'apic';
            const velocities = reference.particles.map(velocity => velocity.slice());
            const matrices = particlePositions.map(() =>
                affine && affineInitialization === 'exact' ? matrix.slice() : [0, 0, 0, 0]);
            const initial = snapshot(velocities, matrices, affine);
            let before;
            const nodes = nodePositions.map((position, index) => ({
                position: position.slice(), mass: nodeMasses[index], velocity: [0, 0]
            }));
            for (let round = 0; round < rounds; round += 1) {
                if (round === rounds - 1) before = snapshot(velocities, matrices, affine);
                for (let n = 0; n < 4; n += 1) {
                    let px = 0;
                    let py = 0;
                    for (let p = 0; p < 4; p += 1) {
                        const { weight, dx, dy } = geometry[p].stencil[n];
                        const C = matrices[p];
                        px += weight * (velocities[p][0] + (affine ? C[0] * dx + C[1] * dy : 0));
                        py += weight * (velocities[p][1] + (affine ? C[2] * dx + C[3] * dy : 0));
                    }
                    nodes[n].velocity[0] = px / nodes[n].mass;
                    nodes[n].velocity[1] = py / nodes[n].mass;
                }

                // There are no forces or constraints: the grid before and
                // after the (absent) dynamics update is identical. FLIP adds
                // sum N (v_grid,new - v_grid,old) = 0, not a PIC overwrite.
                const gridBefore = nodes;
                for (let p = 0; p < 4; p += 1) {
                    let vx = method === 'flip' ? velocities[p][0] : 0;
                    let vy = method === 'flip' ? velocities[p][1] : 0;
                    let bxx = 0;
                    let bxy = 0;
                    let byx = 0;
                    let byy = 0;
                    for (let n = 0; n < 4; n += 1) {
                        const { weight, dx, dy } = geometry[p].stencil[n];
                        const velocity = nodes[n].velocity;
                        vx += weight * (velocity[0] - (method === 'flip' ? gridBefore[n].velocity[0] : 0));
                        vy += weight * (velocity[1] - (method === 'flip' ? gridBefore[n].velocity[1] : 0));
                        if (affine) {
                            bxx += weight * velocity[0] * dx;
                            bxy += weight * velocity[0] * dy;
                            byx += weight * velocity[1] * dx;
                            byy += weight * velocity[1] * dy;
                        }
                    }
                    velocities[p][0] = vx;
                    velocities[p][1] = vy;
                    if (affine) {
                        const inverseD = geometry[p].inverseD;
                        const C = matrices[p];
                        C[0] = bxx * inverseD[0] + bxy * inverseD[2];
                        C[1] = bxx * inverseD[1] + bxy * inverseD[3];
                        C[2] = byx * inverseD[0] + byy * inverseD[2];
                        C[3] = byx * inverseD[1] + byy * inverseD[3];
                    }
                }
            }
            let gridAngular = 0;
            const gridMomentum = [0, 0];
            for (const node of nodes) {
                const px = node.mass * node.velocity[0];
                const py = node.mass * node.velocity[1];
                gridAngular += (node.position[0] - 0.5) * py - (node.position[1] - 0.5) * px;
                gridMomentum[0] += px;
                gridMomentum[1] += py;
            }
            let squaredMatrixError = 0;
            if (affine) {
                for (const C of matrices) {
                    for (let entry = 0; entry < 4; entry += 1) {
                        squaredMatrixError += (C[entry] - matrix[entry]) ** 2;
                    }
                }
            }
            return {
                method, initial, before, after: snapshot(velocities, matrices, affine), nodes,
                gridError: relativeError(nodes.map(node => node.velocity), reference.nodes, referenceGridNorm),
                particleError: relativeError(velocities, reference.particles, referenceParticleNorm),
                matrixError: affine ? Math.sqrt(squaredMatrixError) : null,
                gridAngular, gridMomentum
            };
        });
        return {
            parameters: { preset, rounds, inset, affineInitialization },
            matrix, D: geometry[0].D.slice(), particlePositions, nodePositions, reference, methods
        };
    }

    function kinematics2D(options = {}) {
        assert(options && typeof options === 'object' && !Array.isArray(options), 'Kinematics options must be an object.');
        const {
            preset = 'translation', rate = 1, timeStep = 0.5,
            x = 0.45, y = 0.55, nodeCount = 5, basis = 'linear',
            particleHalfWidthRatio = 0.25
        } = options;
        assert(preset === 'translation' || preset === 'extension' || preset === 'shear' || preset === 'rotation',
            'Preset must be translation, extension, shear or rotation.');
        assert(Number.isFinite(rate) && rate >= 0 && rate <= 2, 'Rate must be finite and in [0, 2].');
        assert(Number.isFinite(timeStep) && timeStep >= 0 && timeStep <= 1, 'timeStep must be finite and in [0, 1].');
        assert(Number.isInteger(nodeCount) && nodeCount >= 3 && nodeCount <= 17, 'nodeCount must be an integer in [3, 17].');
        const stencilX = shapeStencil1D(x, nodeCount, basis, particleHalfWidthRatio);
        const stencilY = shapeStencil1D(y, nodeCount, basis, particleHalfWidthRatio);

        // The exact reference uses the prescribed field, independently of
        // interpolation. Matrices are row-major: [xx, xy, yx, yy].
        let prescribedL;
        let exactF;
        const b = [0, 0];
        const increment = rate * timeStep;
        if (preset === 'translation') {
            prescribedL = [0, 0, 0, 0];
            b[0] = 0.2 * rate;
            b[1] = 0.1 * rate;
            exactF = [1, 0, 0, 1];
        } else if (preset === 'extension') {
            prescribedL = [rate, 0, 0, 0];
            exactF = [Math.exp(increment), 0, 0, 1];
        } else if (preset === 'shear') {
            prescribedL = [0, rate, 0, 0];
            exactF = [1, increment, 0, 1];
        } else {
            prescribedL = [0, -rate, rate, 0];
            const cosine = Math.cos(increment);
            const sine = Math.sin(increment);
            exactF = [cosine, -sine, sine, cosine];
        }

        const spacing = 1 / (nodeCount - 1);
        const width = nodeCount + 2;
        const nodes = [];
        // Prescribe velocities directly, not via particle-to-grid transfer.
        // Exterior nodes are mathematical support, not boundary conditions.
        for (let iy = -1; iy <= nodeCount; iy += 1) {
            for (let ix = -1; ix <= nodeCount; ix += 1) {
                const nx = ix * spacing;
                const ny = iy * spacing;
                nodes.push({
                    x: nx, y: ny,
                    vx: prescribedL[0] * (nx - 0.5) + prescribedL[1] * (ny - 0.5) + b[0],
                    vy: prescribedL[2] * (nx - 0.5) + prescribedL[3] * (ny - 0.5) + b[1],
                    weight: 0, gx: 0, gy: 0,
                    ghost: ix < 0 || ix >= nodeCount || iy < 0 || iy >= nodeCount
                });
            }
        }
        const velocity = [0, 0];
        const L = [0, 0, 0, 0];
        for (const sy of stencilY) {
            for (const sx of stencilX) {
                const node = nodes[(sy.index + 1) * width + sx.index + 1];
                node.weight = sx.weight * sy.weight;
                node.gx = sx.gradient * sy.weight;
                node.gy = sx.weight * sy.gradient;
                velocity[0] += node.vx * node.weight;
                velocity[1] += node.vy * node.weight;
                // Keep zero-weight derivative nodes, including at knots.
                L[0] += node.vx * node.gx;
                L[1] += node.vx * node.gy;
                L[2] += node.vy * node.gx;
                L[3] += node.vy * node.gy;
            }
        }
        const symmetricShear = 0.5 * (L[1] + L[2]);
        const spin = 0.5 * (L[1] - L[2]);
        const D = [L[0], symmetricShear, symmetricShear, L[3]];
        const W = [0, spin, -spin, 0];
        const gradientError = Math.hypot(
            L[0] - prescribedL[0], L[1] - prescribedL[1],
            L[2] - prescribedL[2], L[3] - prescribedL[3]
        );
        // One explicit Euler step, not the exact long-time flow map.
        const eulerF = [1 + timeStep * L[0], timeStep * L[1], timeStep * L[2], 1 + timeStep * L[3]];
        const exactJ = exactF[0] * exactF[3] - exactF[1] * exactF[2];
        const eulerJ = eulerF[0] * eulerF[3] - eulerF[1] * eulerF[2];
        const position = [x, y];
        const exactPosition = [
            0.5 + exactF[0] * (x - 0.5) + exactF[1] * (y - 0.5) + b[0] * timeStep,
            0.5 + exactF[2] * (x - 0.5) + exactF[3] * (y - 0.5) + b[1] * timeStep
        ];
        const eulerPosition = [x + timeStep * velocity[0], y + timeStep * velocity[1]];
        const originalCorners = [[x - 0.06, y - 0.06], [x + 0.06, y - 0.06],
            [x + 0.06, y + 0.06], [x - 0.06, y + 0.06]];
        function transformCorners(F, center) {
            return originalCorners.map(([cx, cy]) => [
                center[0] + F[0] * (cx - x) + F[1] * (cy - y),
                center[1] + F[2] * (cx - x) + F[3] * (cy - y)
            ]);
        }
        return {
            nodes, velocity, L, D, W, prescribedL, gradientError,
            exactF, eulerF, exactJ, eulerJ, position, exactPosition, eulerPosition,
            originalCorners, exactCorners: transformCorners(exactF, exactPosition),
            eulerCorners: transformCorners(eulerF, eulerPosition)
        };
    }

    function elasticBar(options = {}) {
        assert(options && typeof options === 'object' && !Array.isArray(options), 'Elastic bar options must be an object.');
        const { cells = 16, particlesPerCell = 4, cfl = 0.2, periods = 1, transfer = 'flip' } = options;
        assert(cells === 8 || cells === 16 || cells === 32 || cells === 64, 'cells must be 8, 16, 32 or 64.');
        assert(particlesPerCell === 2 || particlesPerCell === 4 || particlesPerCell === 8,
            'particlesPerCell must be 2, 4 or 8.');
        assert(Number.isFinite(cfl) && cfl >= 0.05 && cfl <= 0.5, 'cfl must be finite and in [0.05, 0.5].');
        assert(Number.isFinite(periods) && periods >= 0.25 && periods <= 2, 'periods must be finite and in [0.25, 2].');
        assert(transfer === 'flip' || transfer === 'pic', 'transfer must be flip or pic.');

        // SI units; small strain on a FIXED reference grid, not advected MPM.
        const length = 1;
        const youngModulus = 1e6;
        const density = 1000;
        const area = 0.01;
        const waveSpeed = Math.sqrt(youngModulus / density);
        const velocityAmplitude = 0.001 * waveSpeed;
        const waveNumber = Math.PI / length;
        const angularFrequency = waveNumber * waveSpeed;
        const period = 2 * length / waveSpeed;
        const displacementAmplitude = velocityAmplitude / angularFrequency;
        const stressAmplitude = youngModulus * velocityAmplitude / waveSpeed;
        const duration = periods * period;
        // duration / (cfl * h / c), cancelling common factors before rounding.
        // This CFL range is conservative for this uniform fixed-grid example.
        const stepCount = Math.ceil(2 * periods * cells / cfl);
        const timeStep = duration / stepCount;
        const particleCount = cells * particlesPerCell;
        const nodeCount = cells + 1;
        const particleVolume = area * length / particleCount;
        const particleMass = density * particleVolume;
        const useFlip = transfer === 'flip';

        const referencePosition = new Float64Array(particleCount);
        const displacement = new Float64Array(particleCount);
        const velocity = new Float64Array(particleCount);
        const strain = new Float64Array(particleCount);
        const stress = new Float64Array(particleCount);
        const leftNode = new Uint16Array(particleCount);
        const leftWeight = new Float64Array(particleCount);
        const rightWeight = new Float64Array(particleCount);
        const leftGradient = new Float64Array(particleCount);
        const rightGradient = new Float64Array(particleCount);
        const sineMode = new Float64Array(particleCount);
        const cosineMode = new Float64Array(particleCount);
        const gridMass = new Float64Array(nodeCount);
        const gridMomentum = new Float64Array(nodeCount);
        const gridForce = new Float64Array(nodeCount);
        const gridVelocity = new Float64Array(nodeCount);
        const gridAcceleration = new Float64Array(nodeCount);
        let initialEnergy = 0;

        // Midpoint quadrature, masses, volumes and linear stencils never move.
        for (let p = 0; p < particleCount; p += 1) {
            const X = (p + 0.5) * length / particleCount;
            const stencil = shapeStencil1D(X / length, nodeCount);
            referencePosition[p] = X;
            leftNode[p] = stencil[0].index;
            leftWeight[p] = stencil[0].weight;
            rightWeight[p] = stencil[1].weight;
            leftGradient[p] = stencil[0].gradient / length;
            rightGradient[p] = stencil[1].gradient / length;
            sineMode[p] = Math.sin(waveNumber * X);
            cosineMode[p] = Math.cos(waveNumber * X);
            velocity[p] = velocityAmplitude * sineMode[p];
            gridMass[stencil[0].index] += particleMass * leftWeight[p];
            gridMass[stencil[1].index] += particleMass * rightWeight[p];
            initialEnergy += 0.5 * particleMass * velocity[p] * velocity[p];
        }

        const history = [];
        const sampleIntervals = Math.min(stepCount, 120);
        function sample(time) {
            // Exact values are comparison only: none enter the stepping loop.
            const phaseSine = Math.sin(angularFrequency * time);
            const phaseCosine = Math.cos(angularFrequency * time);
            const particles = new Array(particleCount);
            let kineticEnergy = 0;
            let strainEnergy = 0;
            let displacementSquaredError = 0;
            let velocitySquaredError = 0;
            let stressSquaredError = 0;
            for (let p = 0; p < particleCount; p += 1) {
                const exactDisplacement = displacementAmplitude * sineMode[p] * phaseSine;
                const exactVelocity = velocityAmplitude * sineMode[p] * phaseCosine;
                const exactStress = stressAmplitude * cosineMode[p] * phaseSine;
                const du = displacement[p] - exactDisplacement;
                const dv = velocity[p] - exactVelocity;
                const ds = stress[p] - exactStress;
                displacementSquaredError += du * du;
                velocitySquaredError += dv * dv;
                stressSquaredError += ds * ds;
                kineticEnergy += 0.5 * particleMass * velocity[p] * velocity[p];
                strainEnergy += particleVolume * stress[p] * stress[p] / (2 * youngModulus);
                particles[p] = {
                    referencePosition: referencePosition[p], displacement: displacement[p],
                    velocity: velocity[p], stress: stress[p], exactDisplacement, exactVelocity, exactStress
                };
            }
            // Nonzero peak RMS scales, never the instantaneous exact norm.
            const displacementError = Math.sqrt(2 * displacementSquaredError / particleCount) / displacementAmplitude;
            const velocityError = Math.sqrt(2 * velocitySquaredError / particleCount) / velocityAmplitude;
            const stressError = Math.sqrt(2 * stressSquaredError / particleCount) / stressAmplitude;
            const totalEnergy = kineticEnergy + strainEnergy;
            assert(Number.isFinite(totalEnergy) && Number.isFinite(displacementError) &&
                Number.isFinite(velocityError) && Number.isFinite(stressError),
            'Elastic bar diagnostics became non-finite.');
            history.push({ time, kineticEnergy, strainEnergy, totalEnergy,
                displacementError, velocityError, stressError, particles });
        }

        sample(0);
        for (let step = 1; step <= stepCount; step += 1) {
            gridMomentum.fill(0);
            gridForce.fill(0);
            for (let p = 0; p < particleCount; p += 1) {
                const left = leftNode[p];
                const right = left + 1;
                const momentum = particleMass * velocity[p];
                const integratedStress = particleVolume * stress[p];
                gridMomentum[left] += leftWeight[p] * momentum;
                gridMomentum[right] += rightWeight[p] * momentum;
                // Tension positive: -V sigma dN/dX has units of force (N).
                gridForce[left] -= integratedStress * leftGradient[p];
                gridForce[right] -= integratedStress * rightGradient[p];
            }
            // Both fixed endpoints constrain mapped velocity AND acceleration.
            gridVelocity[0] = gridVelocity[cells] = 0;
            gridAcceleration[0] = gridAcceleration[cells] = 0;
            for (let node = 1; node < cells; node += 1) {
                const acceleration = gridForce[node] / gridMass[node];
                gridAcceleration[node] = acceleration;
                gridVelocity[node] = gridMomentum[node] / gridMass[node] + timeStep * acceleration;
            }
            for (let p = 0; p < particleCount; p += 1) {
                const left = leftNode[p];
                const right = left + 1;
                const interpolatedVelocity = leftWeight[p] * gridVelocity[left] + rightWeight[p] * gridVelocity[right];
                if (useFlip) {
                    // Increment only constrained acceleration, not the change
                    // from an unconstrained boundary momentum projection.
                    velocity[p] += timeStep * (leftWeight[p] * gridAcceleration[left] +
                        rightWeight[p] * gridAcceleration[right]);
                } else {
                    velocity[p] = interpolatedVelocity;
                }
                displacement[p] += timeStep * interpolatedVelocity;
                strain[p] += timeStep * (leftGradient[p] * gridVelocity[left] +
                    rightGradient[p] * gridVelocity[right]);
                stress[p] = youngModulus * strain[p];
                assert(Number.isFinite(displacement[p]) && Number.isFinite(velocity[p]) &&
                    Number.isFinite(strain[p]) && Number.isFinite(stress[p]),
                'Elastic bar state became non-finite.');
            }
            if (step === Math.round(history.length * stepCount / sampleIntervals)) {
                sample(step === stepCount ? duration : step * timeStep);
            }
        }

        return {
            parameters: { cells, particlesPerCell, cfl, periods, transfer, length, youngModulus,
                density, area, velocityAmplitude, waveSpeed, period, timeStep, stepCount,
                initialEnergy, displacementAmplitude, stressAmplitude },
            history
        };
    }

    function particleToGrid2D(particles, options) {
        assert(Array.isArray(particles) && particles.length > 0, 'At least one particle is required.');
        assert(options && typeof options === 'object', 'Mapping options are required.');
        const { nodeCount, basis = 'linear', particleHalfWidthRatio = 0.25 } = options;
        assert(Number.isInteger(nodeCount) && nodeCount >= 3 && nodeCount <= 17, 'nodeCount must be an integer in [3, 17].');
        assert(basis === 'linear' || basis === 'quadratic' || basis === 'gimp', 'Basis must be linear, quadratic or gimp.');
        if (basis === 'gimp') {
            assert(Number.isFinite(particleHalfWidthRatio) && particleHalfWidthRatio > 0 && particleHalfWidthRatio <= 0.5,
                'particleHalfWidthRatio must be finite and in (0, 0.5].');
        }

        const spacing = 1 / (nodeCount - 1);
        const width = nodeCount + 2;
        const nodes = [];
        // One exterior layer supplies mathematical support, not boundary
        // conditions. Its nodes participate in all conservation totals.
        for (let iy = -1; iy <= nodeCount; iy += 1) {
            for (let ix = -1; ix <= nodeCount; ix += 1) {
                nodes.push({
                    index: (iy + 1) * width + ix + 1,
                    ix,
                    iy,
                    x: ix * spacing,
                    y: iy * spacing,
                    ghost: ix < 0 || ix >= nodeCount || iy < 0 || iy >= nodeCount,
                    mass: 0,
                    px: 0,
                    py: 0,
                    vx: 0,
                    vy: 0,
                    fx: 0,
                    fy: 0,
                    contributions: []
                });
            }
        }

        let particleMass = 0;
        let particleMomentumX = 0;
        let particleMomentumY = 0;
        let maxPartitionError = 0;
        let maxGradientSumError = 0;
        for (let particleIndex = 0; particleIndex < particles.length; particleIndex += 1) {
            const particle = particles[particleIndex];
            assert(particle && typeof particle === 'object', 'Each particle must be an object.');
            const { x, y, mass, vx, vy, volume, stressXX, stressYY, stressXY } = particle;
            assert(Number.isFinite(x) && x >= 0 && x <= 1 && Number.isFinite(y) && y >= 0 && y <= 1, 'Particle coordinates must be finite and in [0, 1].');
            assert(Number.isFinite(mass) && mass > 0, 'Particle masses must be finite and positive.');
            assert(Number.isFinite(vx) && Number.isFinite(vy), 'Particle velocities must be finite.');
            assert(Number.isFinite(volume) && volume > 0, 'Particle volumes must be finite and positive.');
            assert(Number.isFinite(stressXX) && Number.isFinite(stressYY) && Number.isFinite(stressXY), 'Particle stresses must be finite.');

            const stencilX = shapeStencil1D(x, nodeCount, basis, particleHalfWidthRatio);
            const stencilY = shapeStencil1D(y, nodeCount, basis, particleHalfWidthRatio);
            particleMass += mass;
            particleMomentumX += mass * vx;
            particleMomentumY += mass * vy;
            let weightSum = 0;
            let gradientSumX = 0;
            let gradientSumY = 0;
            for (let j = 0; j < stencilY.length; j += 1) {
                const sy = stencilY[j];
                for (let i = 0; i < stencilX.length; i += 1) {
                    const sx = stencilX[i];
                    const weight = sx.weight * sy.weight;
                    const gradientX = sx.gradient * sy.weight;
                    const gradientY = sx.weight * sy.gradient;
                    weightSum += weight;
                    gradientSumX += gradientX;
                    gradientSumY += gradientY;
                    if (weight === 0 && gradientX === 0 && gradientY === 0) continue;

                    const node = nodes[(sy.index + 1) * width + sx.index + 1];
                    const mappedMass = mass * weight;
                    node.mass += mappedMass;
                    node.px += mappedMass * vx;
                    node.py += mappedMass * vy;
                    // Tension-positive symmetric Cauchy stress (Pa), volume
                    // in m^3, and spatial gradients in 1/m give force in N:
                    // f_i = -sum_p V_p sigma_p grad(N_i).
                    node.fx -= volume * (stressXX * gradientX + stressXY * gradientY);
                    node.fy -= volume * (stressXY * gradientX + stressYY * gradientY);
                    node.contributions.push({ particleIndex, weight, gradientX, gradientY });
                }
            }
            maxPartitionError = Math.max(maxPartitionError, Math.abs(weightSum - 1));
            maxGradientSumError = Math.max(maxGradientSumError, Math.hypot(gradientSumX, gradientSumY));
        }

        let gridMass = 0;
        let gridMomentumX = 0;
        let gridMomentumY = 0;
        let internalForceX = 0;
        let internalForceY = 0;
        for (let index = 0; index < nodes.length; index += 1) {
            const node = nodes[index];
            // No absolute mass cutoff: even tiny positive masses retain
            // their mapped velocity. Zero-mass nodes can still carry force.
            if (node.mass > 0) {
                node.vx = node.px / node.mass;
                node.vy = node.py / node.mass;
            }
            gridMass += node.mass;
            gridMomentumX += node.px;
            gridMomentumY += node.py;
            internalForceX += node.fx;
            internalForceY += node.fy;
        }

        return {
            nodes,
            totals: {
                particleMass,
                gridMass,
                particleMomentumX,
                particleMomentumY,
                gridMomentumX,
                gridMomentumY,
                massError: gridMass - particleMass,
                momentumErrorX: gridMomentumX - particleMomentumX,
                momentumErrorY: gridMomentumY - particleMomentumY,
                internalForceX,
                internalForceY,
                maxPartitionError,
                maxGradientSumError
            }
        };
    }

    function transferStep(particles, options) {
        const nodeCount = Number(options.nodeCount);
        const timeStep = Number(options.timeStep);
        const acceleration = Number(options.acceleration);
        const flipRatio = Number(options.flipRatio);
        const fixedBoundaries = options.fixedBoundaries !== false;
        assert(Number.isFinite(timeStep) && timeStep > 0, 'timeStep must be positive.');
        assert(Number.isFinite(acceleration), 'acceleration must be finite.');
        assert(Number.isFinite(flipRatio) && flipRatio >= 0 && flipRatio <= 1, 'flipRatio must be in [0, 1].');

        const mapping = particleToGrid(particles, nodeCount);
        const updatedNodes = mapping.nodes.map((node, index) => {
            const constrained = fixedBoundaries && (index === 0 || index === mapping.nodes.length - 1);
            const updatedVelocity = node.mass > EPSILON && !constrained ? node.velocity + acceleration * timeStep : 0;
            return { ...node, updatedVelocity, velocityIncrement: updatedVelocity - node.velocity };
        });

        const updatedParticles = particles.map((particle, particleIndex) => {
            let picVelocity = 0;
            let flipIncrement = 0;
            updatedNodes.forEach(node => {
                const contribution = node.contributions.find(item => item.particleIndex === particleIndex);
                if (!contribution) return;
                picVelocity += contribution.weight * node.updatedVelocity;
                flipIncrement += contribution.weight * node.velocityIncrement;
            });
            const flipVelocity = Number(particle.velocity) + flipIncrement;
            let velocity = (1 - flipRatio) * picVelocity + flipRatio * flipVelocity;
            let position = Number(particle.position) + timeStep * picVelocity;
            if (position < 0 || position > 1) {
                position = clamp(position, 0, 1);
                velocity *= -0.5;
            }
            return { position, velocity, mass: Number(particle.mass), picVelocity, flipVelocity };
        });

        const kineticEnergyBefore = particles.reduce((sum, particle) => sum + 0.5 * Number(particle.mass) * Number(particle.velocity) ** 2, 0);
        const kineticEnergyAfter = updatedParticles.reduce((sum, particle) => sum + 0.5 * particle.mass * particle.velocity ** 2, 0);
        const gridKineticEnergy = updatedNodes.reduce((sum, node) => sum + 0.5 * node.mass * node.updatedVelocity ** 2, 0);
        return { mapping, updatedNodes, updatedParticles, kineticEnergyBefore, kineticEnergyAfter, gridKineticEnergy };
    }

    function vanGenuchten(parameters, suctions) {
        const alpha = Number(parameters.alpha);
        const n = Number(parameters.n);
        const thetaResidual = Number(parameters.thetaResidual);
        const thetaSaturated = Number(parameters.thetaSaturated);
        assert(Number.isFinite(alpha) && alpha > 0, 'alpha must be positive.');
        assert(Number.isFinite(n) && n > 1, 'n must be greater than one.');
        assert(thetaResidual >= 0 && thetaResidual < thetaSaturated, 'Residual water content must be below saturated water content.');
        assert(Array.isArray(suctions), 'suctions must be an array.');

        const m = 1 - 1 / n;
        const points = suctions.map(value => {
            const suction = Math.max(0, Number(value));
            assert(Number.isFinite(suction), 'Suction values must be finite.');
            const effectiveSaturation = Math.pow(1 + Math.pow(alpha * suction, n), -m);
            const waterContent = thetaResidual + (thetaSaturated - thetaResidual) * effectiveSaturation;
            return { suction, effectiveSaturation, waterContent };
        });

        return { alpha, n, m, thetaResidual, thetaSaturated, points };
    }

    function mualemRelativePermeability(effectiveSaturation, lambda) {
        const saturation = clamp(Number(effectiveSaturation), 0, 1);
        if (saturation <= EPSILON) return 0;
        if (saturation >= 1 - EPSILON) return 1;
        return Math.sqrt(saturation) * Math.pow(1 - Math.pow(1 - Math.pow(saturation, 1 / lambda), lambda), 2);
    }

    // Porosity-dependent Tarantino (2009) SWRC as summarized by Zhan et al. (2023), Eqs. (12)-(13).
    function tarantinoSWRC(parameters, suctions) {
        const a = Number(parameters.a);
        const lambda = Number(parameters.lambda);
        const porosity = Number(parameters.porosity);
        const residualSaturation = Number(parameters.residualSaturation);
        const liquidDensity = Number(parameters.liquidDensity || 1000);
        const gravity = Number(parameters.gravity || 9.81);
        assert(Number.isFinite(a) && a > 0, 'a must be positive.');
        assert(Number.isFinite(lambda) && lambda > 0 && lambda < 1, 'lambda must be in (0, 1).');
        assert(Number.isFinite(porosity) && porosity > 0 && porosity < 1, 'porosity must be in (0, 1).');
        assert(Number.isFinite(residualSaturation) && residualSaturation >= 0 && residualSaturation < 1, 'Residual saturation must be in [0, 1).');
        assert(Number.isFinite(liquidDensity) && liquidDensity > 0, 'Liquid density must be positive.');
        assert(Number.isFinite(gravity) && gravity > 0, 'Gravity must be positive.');
        assert(Array.isArray(suctions), 'suctions must be an array.');

        const voidRatio = porosity / (1 - porosity);
        const b = (1 - lambda) / lambda;
        const points = suctions.map(value => {
            const suction = Math.max(0, Number(value));
            assert(Number.isFinite(suction), 'Suction values must be finite.');
            const suctionPressure = suction * 1000;
            const scaledSuction = a * suctionPressure * Math.pow(voidRatio, b) / (liquidDensity * gravity);
            const effectiveSaturation = Math.pow(1 + Math.pow(scaledSuction, 1 / (1 - lambda)), -lambda);
            const degreeOfSaturation = residualSaturation + (1 - residualSaturation) * effectiveSaturation;
            const relativePermeability = mualemRelativePermeability(effectiveSaturation, lambda);
            return { suction, effectiveSaturation, degreeOfSaturation, relativePermeability };
        });
        return { a, lambda, porosity, residualSaturation, liquidDensity, gravity, voidRatio, b, points };
    }

    function validateGrid(grid) {
        assert(Array.isArray(grid) && grid.length >= 2, 'A grid requires at least two rows.');
        const columnCount = grid[0].length;
        assert(columnCount >= 2, 'A grid requires at least two columns.');
        grid.forEach(row => {
            assert(Array.isArray(row) && row.length === columnCount, 'Grid rows must have equal lengths.');
            row.forEach(value => assert(Number.isFinite(Number(value)), 'Grid elevations must be finite.'));
        });
        return { rowCount: grid.length, columnCount };
    }

    function d8Directions(grid) {
        const { rowCount, columnCount } = validateGrid(grid);
        const offsets = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];

        return grid.map((row, rowIndex) => row.map((elevation, columnIndex) => {
            let target = null;
            let steepestSlope = 0;
            offsets.forEach(([rowOffset, columnOffset]) => {
                const nextRow = rowIndex + rowOffset;
                const nextColumn = columnIndex + columnOffset;
                if (nextRow < 0 || nextRow >= rowCount || nextColumn < 0 || nextColumn >= columnCount) return;
                const distance = rowOffset && columnOffset ? Math.SQRT2 : 1;
                const slope = (Number(elevation) - Number(grid[nextRow][nextColumn])) / distance;
                if (slope > steepestSlope + EPSILON) {
                    steepestSlope = slope;
                    target = { row: nextRow, column: nextColumn, slope };
                }
            });
            return target;
        }));
    }

    function traceD8(grid, start, maximumSteps) {
        const { rowCount, columnCount } = validateGrid(grid);
        const row = Number(start.row);
        const column = Number(start.column);
        assert(Number.isInteger(row) && row >= 0 && row < rowCount, 'Start row is outside the grid.');
        assert(Number.isInteger(column) && column >= 0 && column < columnCount, 'Start column is outside the grid.');

        const directions = d8Directions(grid);
        const path = [];
        const visited = new Set();
        const limit = maximumSteps || rowCount * columnCount + 1;
        let current = { row, column };
        let reason = 'sink';

        for (let step = 0; step < limit; step += 1) {
            const key = `${current.row}:${current.column}`;
            if (visited.has(key)) {
                reason = 'loop';
                break;
            }
            visited.add(key);
            path.push(current);
            const next = directions[current.row][current.column];
            if (!next) {
                const edge = current.row === 0 || current.column === 0 || current.row === rowCount - 1 || current.column === columnCount - 1;
                reason = edge ? 'outlet' : 'sink';
                break;
            }
            current = { row: next.row, column: next.column };
        }

        return { path, reason, directions };
    }

    function valleyTerrain(size) {
        assert(Number.isInteger(size) && size >= 3, 'Terrain size must be at least three.');
        const center = (size - 1) / 2;
        return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
            const downslope = (size - 1 - row) * 6;
            const valleyWall = Math.abs(column - center) * 3.2;
            const texture = ((row * 11 + column * 7) % 5) * 0.18;
            return Number((100 + downslope + valleyWall + texture).toFixed(2));
        }));
    }

    function randomTerrain(size, seed) {
        assert(Number.isInteger(size) && size >= 3, 'Terrain size must be at least three.');
        let state = (Number(seed) || 1) >>> 0;
        function random() {
            state = (1664525 * state + 1013904223) >>> 0;
            return state / 4294967296;
        }
        return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
            const regionalSlope = (size - 1 - row) * 4.5;
            const undulation = (random() - 0.5) * 12 + Math.sin((row + column) * 0.8) * 2;
            return Number((100 + regionalSlope + undulation).toFixed(2));
        }));
    }

    root.FireflyLabCore = {
        clamp,
        particleToGrid,
        shapeStencil1D,
        particleToGrid2D,
        kinematics2D,
        transferComparison2D,
        elasticBar,
        transferStep,
        vanGenuchten,
        tarantinoSWRC,
        mualemRelativePermeability,
        d8Directions,
        traceD8,
        valleyTerrain,
        randomTerrain
    };
}(typeof globalThis !== 'undefined' ? globalThis : this));
