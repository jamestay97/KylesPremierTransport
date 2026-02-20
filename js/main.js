(function () {
  document.getElementById('year').textContent = new Date().getFullYear();

  function runWithConfig(config) {
    if (!config || !config.routes || !config.destinations) return;

    var names = {};
    config.destinations.forEach(function (d) {
      names[d.id] = d.name;
    });

    function getRoute(fromId, toId) {
      for (var i = 0; i < config.routes.length; i++) {
        var r = config.routes[i];
        if (r.fromId === fromId && r.toId === toId) return r;
      }
      return null;
    }

    var pricingFrom = document.getElementById('pricing-from');
    var pricingTo = document.getElementById('pricing-to');
    var pricingResult = document.getElementById('pricing-result');
    var pricingValue = document.getElementById('pricing-value');
    var pricingBookBtn = document.getElementById('pricing-book-btn');

    if (pricingFrom && pricingTo) {
      function option(value, label) {
        var o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        return o;
      }
      var zonesOnly = config.destinations.filter(function (d) { return d.id !== 'other'; });
      zonesOnly.forEach(function (d) {
        pricingFrom.appendChild(option(d.id, d.name));
        pricingTo.appendChild(option(d.id, d.name));
      });
      pricingTo.value = 'tpa';

      function updatePricingDisplay() {
        var fromId = pricingFrom.value;
        var toId = pricingTo.value;
        if (!fromId || !toId) {
          pricingResult.style.display = 'none';
          return;
        }
        var route = getRoute(fromId, toId);
        if (!route) {
          pricingValue.textContent = 'Contact for quote';
          pricingResult.style.display = 'block';
          return;
        }
        var priceText = route.priceMin === route.priceMax
          ? '$' + route.priceMin
          : '$' + route.priceMin + '–' + route.priceMax;
        pricingValue.textContent = priceText;
        pricingResult.style.display = 'block';

        if (pricingBookBtn) {
          pricingBookBtn.href = 'book.html?from=' + encodeURIComponent(fromId) + '&to=' + encodeURIComponent(toId);
        }
      }

      pricingFrom.addEventListener('change', updatePricingDisplay);
      pricingTo.addEventListener('change', updatePricingDisplay);
      updatePricingDisplay();
    }

    if (config.googleReviewUrl) {
      var heroReview = document.getElementById('hero-leave-review');
      var footerReview = document.getElementById('footer-leave-review');
      var seeAllReview = document.getElementById('reviews-see-all');
      if (heroReview) heroReview.href = config.googleReviewUrl;
      if (footerReview) footerReview.href = config.googleReviewUrl;
      if (seeAllReview) { seeAllReview.href = config.googleReviewUrl; seeAllReview.style.display = 'inline-block'; }
    }

    var pricingPromoEl = document.getElementById('pricing-promo');
    if (pricingPromoEl && config.roundTripPromo) pricingPromoEl.textContent = config.roundTripPromo;
    var heroAvailabilityEl = document.getElementById('hero-availability');
    if (heroAvailabilityEl && config.shuttlesMessage) heroAvailabilityEl.textContent = config.shuttlesMessage;

    var reviewsList = document.getElementById('reviews-list');
    var reviewsPlaceholder = document.getElementById('reviews-placeholder');
    var reviewsSeeAll = document.getElementById('reviews-see-all');
    if (reviewsList && config.reviews && config.reviews.length > 0) {
      reviewsPlaceholder.style.display = 'none';
      reviewsList.style.display = 'grid';
      reviewsList.innerHTML = '';
      config.reviews.forEach(function (r) {
        var card = document.createElement('div');
        card.className = 'review-card';
        var stars = (r.stars != null && r.stars > 0) ? '★'.repeat(Math.min(5, Math.round(r.stars))) + '☆'.repeat(5 - Math.min(5, Math.round(r.stars))) : '';
        card.innerHTML = (stars ? '<div class="review-stars">' + stars + '</div>' : '') +
          '<p class="review-text">' + (r.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>' +
          '<div class="review-author">' + (r.author || '').replace(/</g, '&lt;') + '</div>' +
          '<div class="review-from">From Google</div>';
        reviewsList.appendChild(card);
      });
      if (reviewsSeeAll && !config.googleReviewUrl) {
        reviewsSeeAll.href = 'https://www.google.com/search?q=Premier+Transport+Tampa+FL+review';
        reviewsSeeAll.style.display = 'inline-block';
      }
    }
  }

  function init() {
    if (window.PremierTransportConfig) {
      runWithConfig(window.PremierTransportConfig);
      return;
    }
    fetch('/api/config')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (c) {
        window.PremierTransportConfig = c;
        runWithConfig(c);
      })
      .catch(function () {
        if (window.PremierTransportConfig) runWithConfig(window.PremierTransportConfig);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
