(function () {
  var root = document.documentElement;

  function update() {
    var bar = document.getElementById('reading-progress-bar');
    if (!bar) return;

    var max = root.scrollHeight - window.innerHeight;
    var progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    var percent = Math.round(progress * 100);

    bar.style.transform = 'scaleX(' + progress + ')';

    var progressbar = bar.parentElement;
    if (progressbar) {
      progressbar.setAttribute('aria-valuenow', String(percent));
      progressbar.setAttribute('aria-valuetext', percent + '%');
    }
  }

  if (!window.__bmReadingProgressBound) {
    window.__bmReadingProgressBound = true;
    var frame = 0;
    window.addEventListener(
      'scroll',
      function () {
        if (frame) return;
        frame = requestAnimationFrame(function () {
          frame = 0;
          update();
        });
      },
      { passive: true },
    );
    window.addEventListener('resize', update);
    window.addEventListener('load', update);
    document.addEventListener('swup:page:view', update);
  }

  update();
})();
