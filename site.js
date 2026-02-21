(function () {
  var yearNode = document.getElementById('y');
  if (yearNode) {
    yearNode.textContent = new Date().getFullYear();
  }

  var shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
})();
