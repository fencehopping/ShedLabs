(function () {
  var yearNode = document.getElementById('y');
  if (yearNode) {
    yearNode.textContent = new Date().getFullYear();
  }

  var shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (!shouldReduceMotion && canHover) {
    startMouseField();
  }

  var revealTargets = document.querySelectorAll('.topbar, .hero, .strip, .panel, .card, .step, .small-card, .work-card');

  if (!revealTargets.length) {
    return;
  }

  revealTargets.forEach(function (node, index) {
    node.classList.add('reveal-ready');
    node.style.transitionDelay = Math.min(index * 55, 240) + 'ms';
  });

  if (shouldReduceMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach(function (node) {
      node.classList.add('in-view');
      node.style.transitionDelay = '0ms';
    });
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) {
          return;
        }
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      });
    },
    {
      threshold: 0.12,
      rootMargin: '0px 0px -8% 0px'
    }
  );

  revealTargets.forEach(function (node) {
    observer.observe(node);
  });

  function startMouseField() {
    var canvas = document.createElement('canvas');
    var context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    var particles = [];
    var particleCount = 64;
    var pointer = {
      x: window.innerWidth * 0.5,
      y: window.innerHeight * 0.5,
      targetX: window.innerWidth * 0.5,
      targetY: window.innerHeight * 0.5
    };
    var animationFrame = null;
    var pixelRatio = 1;

    canvas.className = 'mouse-field';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(canvas, document.body.firstChild);

    function resize() {
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * pixelRatio);
      canvas.height = Math.floor(window.innerHeight * pixelRatio);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      particles = [];
      for (var index = 0; index < particleCount; index += 1) {
        particles.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          baseX: Math.random() * window.innerWidth,
          baseY: Math.random() * window.innerHeight,
          radius: 1.2 + Math.random() * 2.6,
          angle: Math.random() * Math.PI * 2,
          orbit: 18 + Math.random() * 54,
          speed: 0.004 + Math.random() * 0.009,
          hue: 188 + Math.random() * 32
        });
      }
    }

    function updatePointer(event) {
      pointer.targetX = event.clientX;
      pointer.targetY = event.clientY;
    }

    function render() {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      pointer.x += (pointer.targetX - pointer.x) * 0.1;
      pointer.y += (pointer.targetY - pointer.y) * 0.1;

      var halo = context.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 210);
      halo.addColorStop(0, 'rgba(102, 213, 255, 0.28)');
      halo.addColorStop(0.38, 'rgba(59, 130, 246, 0.13)');
      halo.addColorStop(1, 'rgba(59, 130, 246, 0)');
      context.fillStyle = halo;
      context.beginPath();
      context.arc(pointer.x, pointer.y, 210, 0, Math.PI * 2);
      context.fill();

      for (var index = 0; index < particles.length; index += 1) {
        var particle = particles[index];
        particle.angle += particle.speed;

        var orbitX = particle.baseX + Math.cos(particle.angle) * particle.orbit;
        var orbitY = particle.baseY + Math.sin(particle.angle * 0.82) * particle.orbit;
        var dx = orbitX - pointer.x;
        var dy = orbitY - pointer.y;
        var distance = Math.sqrt(dx * dx + dy * dy);
        var pull = Math.max(0, 1 - distance / 260);

        particle.x += (orbitX + (pointer.x - orbitX) * pull * 0.42 - particle.x) * 0.055;
        particle.y += (orbitY + (pointer.y - orbitY) * pull * 0.42 - particle.y) * 0.055;

        context.beginPath();
        context.fillStyle = 'hsla(' + particle.hue + ', 96%, 72%, ' + (0.18 + pull * 0.55) + ')';
        context.arc(particle.x, particle.y, particle.radius + pull * 3.2, 0, Math.PI * 2);
        context.fill();

        if (distance < 170) {
          context.beginPath();
          context.strokeStyle = 'rgba(125, 211, 252, ' + (0.18 * (1 - distance / 170)) + ')';
          context.lineWidth = 1;
          context.moveTo(particle.x, particle.y);
          context.lineTo(pointer.x, pointer.y);
          context.stroke();
        }
      }

      animationFrame = window.requestAnimationFrame(render);
    }

    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('pointermove', updatePointer, { passive: true });

    resize();
    render();

    window.addEventListener('pagehide', function () {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
    });
  }
})();
