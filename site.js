(function () {
  var yearNode = document.getElementById('y');
  if (yearNode) {
    yearNode.textContent = new Date().getFullYear();
  }

  var shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (!shouldReduceMotion && canHover) {
    startCursorEffects();
  }

  var revealTargets = document.querySelectorAll('.topbar, .hero, .strip, .panel, .card, .step, .small-card, .work-card, .trust-strip, .editorial-section, .service-tile, .process-section, .process-line article, .split-section, .cta-band');

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

  function startCursorEffects() {
    var root = document.documentElement;
    var spotlight = document.createElement('div');
    var mouse = {
      x: window.innerWidth * 0.5,
      y: window.innerHeight * 0.5,
      frame: null
    };

    spotlight.className = 'cursor-spotlight';
    spotlight.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(spotlight, document.body.firstChild);

    function scheduleGlobalUpdate() {
      if (mouse.frame) {
        return;
      }

      mouse.frame = window.requestAnimationFrame(function () {
        root.style.setProperty('--mouse-x', mouse.x + 'px');
        root.style.setProperty('--mouse-y', mouse.y + 'px');
        spotlight.classList.add('is-active');
        mouse.frame = null;
      });
    }

    function handleGlobalPointer(event) {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
      scheduleGlobalUpdate();
    }

    window.addEventListener('pointermove', handleGlobalPointer, { passive: true });
    window.addEventListener('pointerleave', function () {
      spotlight.classList.remove('is-active');
    });

    document.querySelectorAll('.glow-card').forEach(function (card) {
      var cardFrame = null;
      var cardX = 0;
      var cardY = 0;

      card.addEventListener('pointermove', function (event) {
        var rect = card.getBoundingClientRect();
        cardX = event.clientX - rect.left;
        cardY = event.clientY - rect.top;

        if (cardFrame) {
          return;
        }

        cardFrame = window.requestAnimationFrame(function () {
          card.style.setProperty('--card-x', cardX + 'px');
          card.style.setProperty('--card-y', cardY + 'px');
          cardFrame = null;
        });
      }, { passive: true });
    });
  }
})();
