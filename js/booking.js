(function () {
  window.gm_authFailure = function () {
    var tripInfoEl = document.getElementById('trip-info');
    if (tripInfoEl) {
      tripInfoEl.innerHTML = 'Map could not load. Check that your Google API key is valid and that Maps JavaScript API, Places API, and Directions API are enabled in Google Cloud Console. <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener">Google Cloud Console</a>';
    }
  };

  function runWithConfig(config) {
    if (!config) return;

    var bookingAvailabilityEl = document.getElementById('booking-availability');
    if (bookingAvailabilityEl && config.shuttlesMessage) bookingAvailabilityEl.textContent = config.shuttlesMessage;

    var dropoffSelect = document.getElementById('dropoff-dest');
    if (!dropoffSelect) return;

    var pickupAddress = document.getElementById('pickup-address');
    var returnDropoffDisplay = document.getElementById('return-dropoff-address');
    var roundTripCheck = document.getElementById('round-trip');
    var returnFields = document.getElementById('return-fields');
    var pickupTime = document.getElementById('pickup-time');
    var specialCheck = document.getElementById('special-requests-check');
    var specialTextWrap = document.getElementById('special-requests-text-wrap');
    var estimatedPriceEl = document.getElementById('estimated-price');
    var addonsContainer = document.getElementById('addons-container');
    var addonsSurchargeNote = document.getElementById('addons-surcharge-note');

    function option(value, label) {
      var o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      return o;
    }

    (config.destinations || []).forEach(function (d) {
      dropoffSelect.appendChild(option(d.id, d.name));
    });

    var dropoffOtherWrap = document.getElementById('dropoff-other-wrap');
    var dropoffOtherInput = document.getElementById('dropoff-other-address');
    function toggleDropoffOther() {
      var isOther = dropoffSelect.value === 'other';
      if (dropoffOtherWrap) dropoffOtherWrap.style.display = isOther ? 'block' : 'none';
      if (dropoffOtherInput) {
        dropoffOtherInput.required = isOther;
        if (!isOther) dropoffOtherInput.value = '';
      }
      onTripInputsChange();
      updateEstimatedPrice();
    }
    dropoffSelect.addEventListener('change', toggleDropoffOther);

    var params = new URLSearchParams(window.location.search);
    var toParam = params.get('to');
    if (toParam && (config.destinations || []).some(function (d) { return d.id === toParam; })) {
      dropoffSelect.value = toParam;
    } else {
      dropoffSelect.value = 'tpa';
    }

    function formatTimeHHMM(hhmm) {
      if (!hhmm) return '';
      var m = hhmm.match(/^(\d{1,2}):(\d{2})/);
      if (!m) return hhmm;
      var h = parseInt(m[1], 10);
      var min = m[2];
      if (h === 0) return '12am';
      if (h === 12) return '12pm';
      if (h < 12) return h + 'am';
      return (h - 12) + 'pm';
    }

    var surchargeStart = config.overnightSurchargeStart || '22:00';
    var surchargeEnd = config.overnightSurchargeEnd || '06:00';
    if (addonsSurchargeNote) {
      addonsSurchargeNote.textContent = 'Pickups between ' + formatTimeHHMM(surchargeStart) + ' and ' + formatTimeHHMM(surchargeEnd) + ' add $' + (config.overnightSurcharge || 10) + ' automatically.';
    }

    var addons = config.addons && config.addons.length ? config.addons.filter(function (a) { return a.enabled !== false; }) : [{ id: 'car_seat', label: 'Car seat or booster', price: config.carSeatFee || 10 }];
    if (addons.length && addonsContainer) {
      addonsContainer.innerHTML = '';
      addons.forEach(function (a) {
        var id = (a.id || 'addon').replace(/\s/g, '_');
        var name = 'addon_' + id;
        var div = document.createElement('div');
        div.className = 'form-group form-check';
        div.style.marginBottom = '0';
        div.innerHTML = '<input type="checkbox" id="addon-' + id + '" name="' + name + '" value="1" data-addon-id="' + id + '" data-addon-price="' + (a.price || 0) + '">' +
          '<label for="addon-' + id + '"><strong>' + (a.label || id) + ' (+$' + (a.price || 0) + ')</strong></label>';
        addonsContainer.appendChild(div);
      });
    }

    function syncReturnAddress() {
      var addr = pickupAddress ? pickupAddress.value.trim() : '';
      if (returnDropoffDisplay) returnDropoffDisplay.value = addr;
    }

    if (roundTripCheck) {
      roundTripCheck.addEventListener('change', function () {
        var show = this.checked;
        returnFields.style.display = show ? 'block' : 'none';
        document.getElementById('return-date').required = show;
        document.getElementById('return-time').required = show;
        if (show) syncReturnAddress();
        applyMinDates();
        updateEstimatedPrice();
        updateReturnTripPreview();
      });
    }

    if (specialCheck) {
      specialCheck.addEventListener('change', function () {
        specialTextWrap.style.display = this.checked ? 'block' : 'none';
      });
    }

    function timeToMins(hhmm) {
      if (!hhmm) return 0;
      var m = hhmm.match(/^(\d{1,2}):(\d{2})/);
      if (!m) return 0;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }

    function isOvernight(timeStr) {
      if (!timeStr) return false;
      var mins = timeToMins(timeStr);
      var startMins = timeToMins(surchargeStart);
      var endMins = timeToMins(surchargeEnd);
      if (startMins > endMins) {
        return mins >= startMins || mins < endMins;
      }
      return mins >= startMins && mins < endMins;
    }

    function getRoutePrice(fromId, toId) {
      for (var i = 0; i < (config.routes || []).length; i++) {
        var r = config.routes[i];
        if (r.fromId === fromId && r.toId === toId) return r;
      }
      return null;
    }

    function getSelectedAddonsTotal() {
      var total = 0;
      if (!addonsContainer) return total;
      addonsContainer.querySelectorAll('input[type="checkbox"]:checked').forEach(function (cb) {
        total += parseInt(cb.getAttribute('data-addon-price'), 10) || 0;
      });
      return total;
    }

    function getDestinationName(id) {
      var d = (config.destinations || []).filter(function (x) { return x.id === id; })[0];
      return d ? d.name : id;
    }

    function updateEstimatedPrice() {
      var toId = dropoffSelect.value;
      if (!estimatedPriceEl) return;
      estimatedPriceEl.style.display = 'none';
      if (!toId) return;
      var fromId = 'pinellas';
      var route = getRoutePrice(fromId, toId);
      if (!route) {
        estimatedPriceEl.innerHTML = '';
        estimatedPriceEl.appendChild(document.createTextNode('We\'ll confirm price when we confirm your ride.'));
        estimatedPriceEl.style.display = 'block';
        return;
      }
      var overnightSurcharge = config.overnightSurcharge || 10;
      var overnightLabel = 'Overnight (' + formatTimeHHMM(surchargeStart) + '\u2013' + formatTimeHHMM(surchargeEnd) + '): +$' + overnightSurcharge;
      var total = 0;
      var lines = [];

      var trip1Price = route.priceMin;
      total += trip1Price;
      var fromName = getDestinationName(fromId);
      var toName = getDestinationName(toId);
      lines.push('Trip 1 (' + fromName + ' \u2192 ' + toName + '): $' + trip1Price);

      if (pickupTime && isOvernight(pickupTime.value)) {
        total += overnightSurcharge;
        lines.push(overnightLabel);
      }

      var roundTripCheck = document.getElementById('round-trip');
      var returnTimeEl = document.getElementById('return-time');
      if (roundTripCheck && roundTripCheck.checked) {
        var returnRoute = getRoutePrice(toId, fromId);
        if (returnRoute) {
          total += returnRoute.priceMin;
          lines.push('Trip 2 (return): $' + returnRoute.priceMin);
          if (returnTimeEl && isOvernight(returnTimeEl.value)) {
            total += overnightSurcharge;
            lines.push('Overnight (return, ' + formatTimeHHMM(surchargeStart) + '\u2013' + formatTimeHHMM(surchargeEnd) + '): +$' + overnightSurcharge);
          }
        }
      }

      var addonTotal = getSelectedAddonsTotal();
      if (addonTotal > 0) {
        total += addonTotal;
        lines.push('Add-ons: +$' + addonTotal);
      }

      lines.push('Total: $' + total);

      var breakdown = document.createElement('ul');
      breakdown.className = 'price-breakdown';
      breakdown.setAttribute('aria-label', 'Price breakdown');
      lines.forEach(function (text, i) {
        var li = document.createElement('li');
        li.className = i === lines.length - 1 ? 'price-total-line' : 'price-breakdown-line';
        li.textContent = text;
        breakdown.appendChild(li);
      });
      estimatedPriceEl.innerHTML = '';
      estimatedPriceEl.appendChild(breakdown);
      estimatedPriceEl.style.display = 'block';
    }

    if (pickupTime) {
      pickupTime.addEventListener('change', updateEstimatedPrice);
      pickupTime.addEventListener('input', updateEstimatedPrice);
    }
    dropoffSelect.addEventListener('change', updateEstimatedPrice);
    if (addonsContainer) {
      addonsContainer.addEventListener('change', function () {
        updateEstimatedPrice();
      });
    }


    var tripPreviewSection = document.getElementById('trip-preview-section');
    var tripInfoEl = document.getElementById('trip-info');
    var tripMapEl = document.getElementById('trip-map');
    var tripMapLink = document.getElementById('trip-map-link');
    var pickupDateEl = document.getElementById('pickup-date');
    var returnTripPreviewSection = document.getElementById('return-trip-preview-section');
    var returnTripInfoEl = document.getElementById('return-trip-info');
    var returnTripMapEl = document.getElementById('return-trip-map');
    var returnTripMapLink = document.getElementById('return-trip-map-link');
    var returnDateEl = document.getElementById('return-date');
    var returnTimeEl = document.getElementById('return-time');

    function getMinBookingDateTime() {
      var d = new Date();
      d.setTime(d.getTime() + 24 * 60 * 60 * 1000);
      return d;
    }

    function getMinBookingDate() {
      var d = getMinBookingDateTime();
      var y = d.getFullYear();
      var m = ('0' + (d.getMonth() + 1)).slice(-2);
      var day = ('0' + d.getDate()).slice(-2);
      return y + '-' + m + '-' + day;
    }

    function getMinBookingTime() {
      var d = getMinBookingDateTime();
      var h = d.getHours();
      var min = d.getMinutes();
      return ('0' + h).slice(-2) + ':' + ('0' + min).slice(-2);
    }

    function isPickupAtLeast24h() {
      if (!pickupDateEl || !pickupTime) return true;
      var dateStr = pickupDateEl.value;
      var timeStr = pickupTime.value;
      if (!dateStr || !timeStr) return false;
      var chosen = new Date(dateStr + 'T' + timeStr + ':00');
      return !isNaN(chosen.getTime()) && chosen.getTime() >= getMinBookingDateTime().getTime();
    }

    function applyMinDates() {
      var minDate = getMinBookingDate();
      var minTime = getMinBookingTime();
      if (pickupDateEl) {
        pickupDateEl.setAttribute('min', minDate);
        if (pickupDateEl.value && pickupDateEl.value < minDate) {
          pickupDateEl.value = minDate;
        }
        validatePickup24h();
      }
      if (pickupTime) {
        if (pickupDateEl && pickupDateEl.value === minDate) {
          pickupTime.setAttribute('min', minTime);
        } else {
          pickupTime.removeAttribute('min');
        }
        validatePickup24h();
      }
      if (returnDateEl) {
        var returnMin = minDate;
        if (pickupDateEl && pickupDateEl.value && pickupDateEl.value > minDate) returnMin = pickupDateEl.value;
        returnDateEl.setAttribute('min', returnMin);
        if (returnDateEl.value && returnDateEl.value < returnMin) returnDateEl.value = returnMin;
      }
    }

    function validatePickup24h() {
      var msg = 'Appointments within 24 hours may not be confirmed. Call (727) 999-4999 to confirm.';
      var errorEl = document.getElementById('pickup-24h-error');
      if (!pickupDateEl) return;
      if (!isPickupAtLeast24h() && pickupDateEl.value && pickupTime && pickupTime.value) {
        pickupDateEl.setCustomValidity(msg);
        if (pickupTime) pickupTime.setCustomValidity(msg);
        if (errorEl) {
          errorEl.innerHTML = 'Appointments made within 24 hours may not be confirmed. Call to confirm at <a href="tel:+17279994999">(727) 999-4999</a>.';
          errorEl.style.display = 'block';
        }
      } else {
        pickupDateEl.setCustomValidity('');
        if (pickupTime) pickupTime.setCustomValidity('');
        if (errorEl) errorEl.style.display = 'none';
      }
    }

    if (pickupDateEl) {
      pickupDateEl.addEventListener('change', function () {
        if (pickupDateEl.value && pickupDateEl.value < getMinBookingDate()) {
          pickupDateEl.value = getMinBookingDate();
        }
        applyMinDates();
      });
    }
    if (pickupTime) {
      pickupTime.addEventListener('change', validatePickup24h);
      pickupTime.addEventListener('input', validatePickup24h);
    }

    function getDestinationAddress(destId) {
      if (destId === 'other' && dropoffOtherInput) return (dropoffOtherInput.value || '').trim();
      var d = (config.destinations || []).filter(function (x) { return x.id === destId; })[0];
      return (d && (d.address || d.name)) || '';
    }

    function swapAddresses() {
      var originAddr = (pickupAddress && pickupAddress.value) ? pickupAddress.value.trim() : '';
      var destId = dropoffSelect.value;
      var destAddr = getDestinationAddress(destId);
      if (!originAddr && !destAddr) return;
      pickupAddress.value = destAddr;
      if (destId === 'other' && dropoffOtherInput) dropoffOtherInput.value = '';
      var matched = (config.destinations || []).filter(function (d) {
        var a = (d.address || d.name || '').trim();
        return a && (a === originAddr || originAddr.indexOf(a) !== -1);
      })[0];
      if (matched) {
        dropoffSelect.value = matched.id;
        if (dropoffOtherWrap) dropoffOtherWrap.style.display = 'none';
        if (dropoffOtherInput) { dropoffOtherInput.required = false; dropoffOtherInput.value = ''; }
      } else {
        dropoffSelect.value = 'other';
        if (dropoffOtherWrap) dropoffOtherWrap.style.display = 'block';
        if (dropoffOtherInput) { dropoffOtherInput.required = true; dropoffOtherInput.value = originAddr; }
      }
      toggleDropoffOther();
      syncReturnAddress();
      onTripInputsChange();
      updateEstimatedPrice();
    }
    var swapBtn = document.getElementById('swap-addresses-btn');
    if (swapBtn) swapBtn.addEventListener('click', swapAddresses);

    function initPlacesAutocomplete() {
      if (!pickupAddress || !window.google || !window.google.maps || !window.google.maps.places) return;
      if (pickupAddress._autocompleteAttached) return;
      try {
        pickupAddress._autocompleteAttached = true;
        var autocomplete = new google.maps.places.Autocomplete(pickupAddress, {
          types: ['address'],
          fields: ['formatted_address'],
          componentRestrictions: { country: 'us' }
        });
        autocomplete.addListener('place_changed', function () {
          var place = autocomplete.getPlace();
          if (place && place.formatted_address) {
            pickupAddress.value = place.formatted_address;
            onTripInputsChange();
          }
        });
      } catch (e) {
        pickupAddress._autocompleteAttached = false;
      }
    }

    function initReturnPlacesAutocomplete() {
      if (!returnDropoffDisplay || !window.google || !window.google.maps || !window.google.maps.places) return;
      if (returnDropoffDisplay._autocompleteAttached) return;
      try {
        returnDropoffDisplay._autocompleteAttached = true;
        var autocomplete = new google.maps.places.Autocomplete(returnDropoffDisplay, {
          types: ['address'],
          fields: ['formatted_address'],
          componentRestrictions: { country: 'us' }
        });
        autocomplete.addListener('place_changed', function () {
          var place = autocomplete.getPlace();
          if (place && place.formatted_address) {
            returnDropoffDisplay.value = place.formatted_address;
            onReturnTripInputsChange();
          }
        });
      } catch (e) {
        returnDropoffDisplay._autocompleteAttached = false;
      }
    }

    function buildDepartureDate() {
      if (!pickupDateEl || !pickupTime) return null;
      var dateStr = pickupDateEl.value;
      var timeStr = pickupTime.value;
      if (!dateStr || !timeStr) return null;
      var parts = timeStr.match(/^(\d{1,2}):(\d{2})/);
      if (!parts) return null;
      return new Date(dateStr + 'T' + timeStr + ':00');
    }

    function formatArrivalTime(arrivalDate, departureDate) {
      if (!arrivalDate || !(arrivalDate instanceof Date) || isNaN(arrivalDate.getTime())) return '';
      var h = arrivalDate.getHours();
      var m = arrivalDate.getMinutes();
      var ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      var timeStr = h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
      if (departureDate && departureDate instanceof Date) {
        var sameDay = arrivalDate.getDate() === departureDate.getDate() && arrivalDate.getMonth() === departureDate.getMonth() && arrivalDate.getFullYear() === departureDate.getFullYear();
        if (sameDay) return timeStr;
        var nextDay = new Date(departureDate);
        nextDay.setDate(nextDay.getDate() + 1);
        var isNextDay = arrivalDate.getDate() === nextDay.getDate() && arrivalDate.getMonth() === nextDay.getMonth() && arrivalDate.getFullYear() === nextDay.getFullYear();
        if (isNextDay) return 'Next day, ' + timeStr;
      }
      var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return days[arrivalDate.getDay()] + ', ' + timeStr;
    }

    var tripPreviewDebounce;
    function updateTripPreview() {
      var origin = pickupAddress ? pickupAddress.value.trim() : '';
      var destId = dropoffSelect.value;
      var destAddress = getDestinationAddress(destId);
      if (!origin || !destAddress) {
        if (tripPreviewSection) tripPreviewSection.style.display = 'none';
        return;
      }
      if (!tripPreviewSection || !tripInfoEl || !tripMapEl) return;

      tripPreviewSection.style.display = 'block';
      var mapsUrl = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(origin) + '&destination=' + encodeURIComponent(destAddress);
      if (tripMapLink) {
        tripMapLink.href = mapsUrl;
        tripMapLink.style.display = 'inline-block';
        tripMapLink.textContent = 'View route on Google Maps';
      }

      var apiKey = config.googleMapsApiKey || '';
      if (apiKey && window.google && window.google.maps) {
        initPlacesAutocomplete();
        var departureTime = buildDepartureDate() || new Date();
        var request = {
          origin: origin,
          destination: destAddress,
          travelMode: google.maps.TravelMode.DRIVING,
          drivingOptions: { departureTime: departureTime }
        };
        var directionsService = new google.maps.DirectionsService();
        directionsService.route(request, function (response, status) {
          if (status === google.maps.DirectionsStatus.OK && response.routes[0]) {
            var leg = response.routes[0].legs[0];
            var durationSec = (leg.duration_in_traffic || leg.duration).value;
            var arrivalTime = new Date(departureTime.getTime() + durationSec * 1000);
            var arrivalStr = formatArrivalTime(arrivalTime, departureTime);
            var hasDate = pickupDateEl && pickupDateEl.value && pickupDateEl.value.trim();
            var hasTime = pickupTime && pickupTime.value && pickupTime.value.trim();
            var showArrival = hasDate && hasTime && arrivalStr;
            var parts = [];
            if (showArrival) {
              parts.push('<div class="trip-arrival-box"><strong>Estimated arrival:</strong> <span class="trip-arrival-time">' + arrivalStr + '</span><br><span class="trip-arrival-note">Important for catching your flight.</span></div>');
            }
            if (leg.distance) parts.push('<strong>Distance:</strong> ' + leg.distance.text);
            if (leg.duration_in_traffic) {
              parts.push('<strong>Drive time (for your departure):</strong> ' + leg.duration_in_traffic.text);
            } else if (leg.duration) {
              parts.push('<strong>Drive time:</strong> ' + leg.duration.text);
            }
            var depLabel = buildDepartureDate() ? 'Estimate for departure at your selected date & time.' : 'Estimate for current traffic.';
            parts.push('<span class="trip-departure-note">' + depLabel + '</span>');
            tripInfoEl.innerHTML = parts.join(' &middot; ');
            var map = new google.maps.Map(tripMapEl, { zoom: 10, center: leg.start_location });
            var renderer = new google.maps.DirectionsRenderer({ map: map, suppressMarkers: false });
            renderer.setDirections(response);
          } else {
            var errMsg = status === google.maps.DirectionsStatus.REQUEST_DENIED || status === google.maps.DirectionsStatus.OVER_QUERY_LIMIT
              ? 'Enable Directions API and check your API key in Google Cloud Console.'
              : 'Route found.';
            tripInfoEl.innerHTML = errMsg + ' <a href="' + mapsUrl + '" target="_blank" rel="noopener">View on Google Maps</a> for details.';
          }
        });
      } else if (apiKey && !window.google) {
        tripInfoEl.textContent = 'Loading map…';
        if (!window._gmapsLoading) {
          window._gmapsLoading = true;
          var s = document.createElement('script');
          s.src = 'https://maps.googleapis.com/maps/api/js?key=' + apiKey + '&libraries=places&callback=_gmapsTripCallback';
          s.async = true;
          s.defer = true;
          window._gmapsTripCallback = function () {
            window._gmapsLoading = false;
            initPlacesAutocomplete();
            updateTripPreview();
            updateReturnTripPreview();
          };
          document.head.appendChild(s);
        }
      } else {
        tripInfoEl.innerHTML = 'Select date and time above for a traffic-aware estimate. <a href="' + mapsUrl + '" target="_blank" rel="noopener">View route on Google Maps</a>.';
      }
    }

    function buildReturnDepartureDate() {
      if (!returnDateEl || !returnTimeEl) return null;
      var dateStr = returnDateEl.value;
      var timeStr = returnTimeEl.value;
      if (!dateStr || !timeStr) return null;
      var parts = timeStr.match(/^(\d{1,2}):(\d{2})/);
      if (!parts) return null;
      return new Date(dateStr + 'T' + timeStr + ':00');
    }

    var returnTripPreviewDebounce;
    function updateReturnTripPreview() {
      if (!roundTripCheck || !roundTripCheck.checked) {
        if (returnTripPreviewSection) returnTripPreviewSection.style.display = 'none';
        if (returnTripMapEl) returnTripMapEl.innerHTML = '';
        return;
      }
      var returnOrigin = getDestinationAddress(dropoffSelect.value);
      var returnDest = returnDropoffDisplay ? returnDropoffDisplay.value.trim() : '';
      if (!returnOrigin || !returnDest) {
        if (returnTripPreviewSection) returnTripPreviewSection.style.display = 'none';
        if (returnTripMapEl) returnTripMapEl.innerHTML = '';
        return;
      }
      if (!returnTripPreviewSection || !returnTripInfoEl || !returnTripMapEl) return;

      returnTripPreviewSection.style.display = 'block';
      var mapsUrl = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(returnOrigin) + '&destination=' + encodeURIComponent(returnDest);
      if (returnTripMapLink) {
        returnTripMapLink.href = mapsUrl;
        returnTripMapLink.style.display = 'inline-block';
        returnTripMapLink.textContent = 'View return route on Google Maps';
      }

      var apiKey = config.googleMapsApiKey || '';
      if (apiKey && window.google && window.google.maps) {
        initReturnPlacesAutocomplete();
        var departureTime = buildReturnDepartureDate() || new Date();
        var request = {
          origin: returnOrigin,
          destination: returnDest,
          travelMode: google.maps.TravelMode.DRIVING,
          drivingOptions: { departureTime: departureTime }
        };
        var directionsService = new google.maps.DirectionsService();
        directionsService.route(request, function (response, status) {
          if (status === google.maps.DirectionsStatus.OK && response.routes[0]) {
            var leg = response.routes[0].legs[0];
            var durationSec = (leg.duration_in_traffic || leg.duration).value;
            var arrivalTime = new Date(departureTime.getTime() + durationSec * 1000);
            var arrivalStr = formatArrivalTime(arrivalTime, departureTime);
            var hasReturnDate = returnDateEl && returnDateEl.value && returnDateEl.value.trim();
            var hasReturnTime = returnTimeEl && returnTimeEl.value && returnTimeEl.value.trim();
            var showArrival = hasReturnDate && hasReturnTime && arrivalStr;
            var parts = [];
            if (showArrival) {
              parts.push('<div class="trip-arrival-box"><strong>Estimated arrival home:</strong> <span class="trip-arrival-time">' + arrivalStr + '</span></div>');
            }
            if (leg.distance) parts.push('<strong>Distance:</strong> ' + leg.distance.text);
            if (leg.duration_in_traffic) {
              parts.push('<strong>Drive time (for your return):</strong> ' + leg.duration_in_traffic.text);
            } else if (leg.duration) {
              parts.push('<strong>Drive time:</strong> ' + leg.duration.text);
            }
            var depLabel = buildReturnDepartureDate() ? 'Estimate for return at your selected date & time.' : 'Estimate for current traffic.';
            parts.push('<span class="trip-departure-note">' + depLabel + '</span>');
            returnTripInfoEl.innerHTML = parts.join(' &middot; ');
            var map = new google.maps.Map(returnTripMapEl, { zoom: 10, center: leg.start_location });
            var renderer = new google.maps.DirectionsRenderer({ map: map, suppressMarkers: false });
            renderer.setDirections(response);
          } else {
            var errMsg = status === google.maps.DirectionsStatus.REQUEST_DENIED || status === google.maps.DirectionsStatus.OVER_QUERY_LIMIT
              ? 'Enable Directions API and check your API key in Google Cloud Console.'
              : 'Route found.';
            returnTripInfoEl.innerHTML = errMsg + ' <a href="' + mapsUrl + '" target="_blank" rel="noopener">View on Google Maps</a> for details.';
          }
        });
      } else if (apiKey && !window.google) {
        returnTripInfoEl.textContent = 'Loading map…';
      } else {
        returnTripInfoEl.innerHTML = 'Enter return date and time above for a traffic-aware estimate. <a href="' + mapsUrl + '" target="_blank" rel="noopener">View return route on Google Maps</a>.';
      }
    }

    function onReturnTripInputsChange() {
      updateEstimatedPrice();
      clearTimeout(returnTripPreviewDebounce);
      returnTripPreviewDebounce = setTimeout(updateReturnTripPreview, 400);
    }

    function onTripInputsChange() {
      clearTimeout(tripPreviewDebounce);
      tripPreviewDebounce = setTimeout(updateTripPreview, 400);
    }
    if (pickupAddress) {
      pickupAddress.addEventListener('input', onTripInputsChange);
      pickupAddress.addEventListener('change', onTripInputsChange);
    }
    if (pickupDateEl) {
      pickupDateEl.addEventListener('change', onTripInputsChange);
    }
    if (pickupTime) {
      pickupTime.addEventListener('change', onTripInputsChange);
    }
    dropoffSelect.addEventListener('change', onTripInputsChange);
    dropoffSelect.addEventListener('change', onReturnTripInputsChange);
    if (dropoffOtherInput) {
      dropoffOtherInput.addEventListener('input', onTripInputsChange);
      dropoffOtherInput.addEventListener('change', onTripInputsChange);
    }
    if (returnDateEl) returnDateEl.addEventListener('change', onReturnTripInputsChange);
    if (returnTimeEl) returnTimeEl.addEventListener('change', onReturnTripInputsChange);
    if (returnDropoffDisplay) {
      returnDropoffDisplay.addEventListener('input', onReturnTripInputsChange);
      returnDropoffDisplay.addEventListener('change', onReturnTripInputsChange);
    }

    var form = document.getElementById('booking-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        validatePickup24h();
        if (!form.checkValidity()) {
          form.querySelectorAll('input[required], select[required]').forEach(function (el) {
            if (!el.checkValidity()) el.classList.add('field-error');
          });
          if (pickupDateEl && !pickupDateEl.validity.valid) pickupDateEl.classList.add('field-error');
          if (pickupTime && !pickupTime.validity.valid) pickupTime.classList.add('field-error');
          return;
        }
        if (!isPickupAtLeast24h()) {
          validatePickup24h();
          if (pickupDateEl) pickupDateEl.classList.add('field-error');
          if (pickupTime) pickupTime.classList.add('field-error');
            var errEl = document.getElementById('pickup-24h-error');
            if (errEl) {
              errEl.innerHTML = 'Appointments made within 24 hours may not be confirmed. Call to confirm at <a href="tel:+17279994999">(727) 999-4999</a>.';
              errEl.style.display = 'block';
            }
          return;
        }
        var formData = new FormData(form);
        var payload = {};
        formData.forEach(function (value, key) {
          payload[key] = value;
        });
        var nextUrl = (form.querySelector('input[name="_next"]') || {}).value || (window.location.pathname + '?submitted=1');
        var formAction = form.action || '';

        fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function (res) {
          if (!res.ok && res.status === 400) {
            var errEl = document.getElementById('pickup-24h-error');
            if (errEl) {
              errEl.innerHTML = 'Appointments made within 24 hours may not be confirmed. Call to confirm at <a href="tel:+17279994999">(727) 999-4999</a>.';
              errEl.style.display = 'block';
            }
            if (pickupDateEl) pickupDateEl.classList.add('field-error');
            if (pickupTime) pickupTime.classList.add('field-error');
            return Promise.reject(new Error('Pickup too soon'));
          }
          return res;
        }).catch(function (err) {
          if (err && err.message === 'Pickup too soon') return Promise.reject(err);
          return { ok: true };
        }).then(function (res) {
          if (res && !res.ok) return;
          if (formAction) {
            return fetch(formAction, { method: 'POST', body: formData }).then(function () {
              window.location.href = nextUrl;
            }).catch(function () {
              window.location.href = nextUrl;
            });
          }
          window.location.href = nextUrl;
        });
      });
      function clearFieldError() {
        if (this.checkValidity()) this.classList.remove('field-error');
      }
      form.querySelectorAll('input[required], select[required]').forEach(function (el) {
        el.addEventListener('input', clearFieldError);
        el.addEventListener('change', clearFieldError);
      });
    }

    toggleDropoffOther();
    applyMinDates();
    updateEstimatedPrice();
    updateTripPreview();
    updateReturnTripPreview();
  }

  function init() {
    if (window.location.search.indexOf('submitted=1') !== -1) {
      var successEl = document.getElementById('submit-success');
      var formEl = document.getElementById('booking-form');
      if (successEl) successEl.style.display = 'block';
      if (formEl) formEl.style.display = 'none';
      return;
    }

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
