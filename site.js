(function () {
  resetInitialScroll();

  var yearNode = document.getElementById('y');
  if (yearNode) {
    yearNode.textContent = new Date().getFullYear();
  }

  var shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var topbar = document.querySelector('.topbar');

  if (topbar) {
    startHeaderScroll(topbar);
  }

  if (!shouldReduceMotion && canHover) {
    startCursorEffects();
  }

  var revealTargets = document.querySelectorAll('.hero, .strip, .panel, .card, .step, .small-card, .work-card, .product-carousel, .editorial-section, .service-tile, .process-section, .process-line article, .split-section, .cta-band');

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

  function startHeaderScroll(header) {
    var compactEnterOffset = 118;
    var compactExitOffset = 54;
    var scrollFrame = null;
    var isCompact = false;
    var animatedNodes = Array.prototype.slice.call(header.querySelectorAll('.brand, .nav'));

    function animateHeaderShift(nextCompact) {
      if (shouldReduceMotion || !animatedNodes.length) {
        document.body.classList.toggle('header-compact', nextCompact);
        return;
      }

      var beforeRects = animatedNodes.map(function (node) {
        return node.getBoundingClientRect();
      });

      document.body.classList.toggle('header-compact', nextCompact);

      animatedNodes.forEach(function (node, index) {
        var afterRect = node.getBoundingClientRect();
        var beforeRect = beforeRects[index];
        var deltaX = beforeRect.left - afterRect.left;
        var deltaY = beforeRect.top - afterRect.top;

        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
          return;
        }

        node.animate(
          [
            { transform: 'translate3d(' + deltaX + 'px, ' + deltaY + 'px, 0)' },
            { transform: 'translate3d(0, 0, 0)' }
          ],
          {
            duration: 640,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
          }
        );
      });
    }

    function updateHeaderState() {
      var scrollY = window.scrollY;
      var nextCompact = isCompact;

      if (!isCompact && scrollY > compactEnterOffset) {
        nextCompact = true;
      } else if (isCompact && scrollY < compactExitOffset) {
        nextCompact = false;
      }

      if (nextCompact !== isCompact) {
        isCompact = nextCompact;
        animateHeaderShift(isCompact);
      }

      header.setAttribute('data-compact', isCompact ? 'true' : 'false');
      scrollFrame = null;
    }

    function scheduleHeaderUpdate() {
      if (scrollFrame) {
        return;
      }

      scrollFrame = window.requestAnimationFrame(updateHeaderState);
    }

    updateHeaderState();
    window.requestAnimationFrame(function () {
      document.body.classList.add('header-ready');
    });
    window.addEventListener('scroll', scheduleHeaderUpdate, { passive: true });
    window.addEventListener('resize', scheduleHeaderUpdate);
  }

  function resetInitialScroll() {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    if (window.location.hash) {
      return;
    }

    function forceTop() {
      window.scrollTo(0, 0);
    }

    function settleAtTop() {
      var frameCount = 0;

      forceTop();

      function tick() {
        forceTop();
        frameCount += 1;

        if (frameCount < 12) {
          window.requestAnimationFrame(tick);
        }
      }

      window.requestAnimationFrame(tick);
      window.setTimeout(forceTop, 250);
      window.setTimeout(forceTop, 600);
    }

    settleAtTop();
    window.addEventListener('pageshow', settleAtTop);
  }

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
