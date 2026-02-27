/**
 * saferspaces Pricing Calculator Wizard
 * Multi-step wizard for calculating custom pricing based on venue type, usage, capacity, etc.
 * Pricing logic mirrors https://www.saferspaces.io/pricing
 */
(function() {
  'use strict';

  // ===== STATE =====
  var state = {
    currentStep: 1,
    totalSteps: 6,
    venueType: null,       // 'club' | 'stadion' | 'stadtfest' | 'andere'
    usage: null,           // 'dauerhaft' | 'einmalig'
    capacity: 5000,
    nonprofit: null,       // true | false
    customCI: null,        // true | false
    contractYears: 1       // 1 | 2 | 3
  };

  // ===== PRICING ENGINE =====

  // Permanent usage: progressive tiered per-person pricing (like tax brackets)
  var PERMANENT_TIERS = [
    { threshold: 5000,     rate: 0.07 },
    { threshold: 10000,    rate: 0.03 },
    { threshold: Infinity, rate: 0.01 }
  ];

  // One-time events: progressive tiered pricing
  var EVENT_TIERS = [
    { threshold: 10000,    rate: 0.07 },
    { threshold: 30000,    rate: 0.03 },
    { threshold: 300000,   rate: 0.01 },
    { threshold: 1000000,  rate: 0.005 },
    { threshold: Infinity, rate: 0.001 }
  ];

  // Setup fees: by venue type
  // Club and Venue (stadion) have fixed setup fees
  // Event (stadtfest) and Andere show "ab 690 €"
  var SETUP_FEES = {
    club:      190,
    stadion:   3200,
    stadtfest: 690,   // minimum, displayed as "ab 690 €"
    andere:    690    // minimum, displayed as "ab 690 €"
  };

  // Default usage modes per venue type
  var DEFAULT_USAGE = {
    club: 'dauerhaft',
    stadion: 'dauerhaft',
    stadtfest: 'einmalig'
    // 'andere' -> user selects
  };

  // Default capacities per venue type
  var DEFAULT_CAPACITIES = {
    club: 500,
    stadion: 15000,
    stadtfest: 250000,
    andere: 5000
  };

  // Modifiers
  var CI_MARKUP = 1.4;  // +40% on base price
  var CONTRACT_DISCOUNTS = { 1: 0, 2: 0.10, 3: 0.15 };

  function calcTieredPrice(capacity, tiers) {
    var price = 0;
    var lowerBound = 0;
    for (var i = 0; i < tiers.length; i++) {
      var unitsInTier = Math.min(capacity, tiers[i].threshold) - lowerBound;
      if (unitsInTier <= 0) break;
      price += unitsInTier * tiers[i].rate;
      lowerBound = tiers[i].threshold;
      if (capacity <= tiers[i].threshold) break;
    }
    return price;
  }

  function getSetupFee() {
    var type = state.venueType || 'andere';
    return SETUP_FEES[type] || SETUP_FEES.andere;
  }

  function isSetupFeeFixed() {
    return state.venueType === 'club' || state.venueType === 'stadion';
  }

  function calculatePrice() {
    var basePrice;

    if (state.usage === 'dauerhaft') {
      // Monthly price from tiers, then annualize
      var monthlyPrice = calcTieredPrice(state.capacity, PERMANENT_TIERS);
      basePrice = monthlyPrice * 12;
    } else {
      // One-time event price
      basePrice = calcTieredPrice(state.capacity, EVENT_TIERS);
    }

    // Custom CI markup (+40% on base price)
    if (state.customCI) {
      basePrice *= CI_MARKUP;
    }

    // Contract length discount (only for dauerhaft)
    var discount = 0;
    if (state.usage === 'dauerhaft') {
      discount = CONTRACT_DISCOUNTS[state.contractYears] || 0;
      basePrice *= (1 - discount);
    }

    // Setup fee: based on venue type + nonprofit (NOT affected by CI)
    var setupFee = getSetupFee();

    // Per-person calculation
    var perPersonPerMonth;
    if (state.usage === 'dauerhaft') {
      perPersonPerMonth = state.capacity > 0 ? basePrice / state.capacity / 12 : 0;
    } else {
      perPersonPerMonth = state.capacity > 0 ? basePrice / state.capacity : 0;
    }

    return {
      annual: Math.round(basePrice * 100) / 100,
      monthly: state.usage === 'dauerhaft' ? Math.round((basePrice / 12) * 100) / 100 : null,
      perPersonPerMonth: Math.round(perPersonPerMonth * 10000) / 10000,
      setupFee: Math.round(setupFee * 100) / 100
    };
  }

  // ===== SLIDER: LOGARITHMIC SCALE =====
  var SLIDER_MIN_CAP = 100;
  var SLIDER_MAX_CAP = 5000000;
  var SLIDER_MIN_LOG = Math.log(SLIDER_MIN_CAP);
  var SLIDER_MAX_LOG = Math.log(SLIDER_MAX_CAP);

  function sliderToCapacity(position) {
    var logVal = SLIDER_MIN_LOG + (position / 100) * (SLIDER_MAX_LOG - SLIDER_MIN_LOG);
    var rawCap = Math.exp(logVal);
    if (rawCap < 500) return Math.round(rawCap / 50) * 50;
    if (rawCap < 5000) return Math.round(rawCap / 100) * 100;
    if (rawCap < 50000) return Math.round(rawCap / 500) * 500;
    if (rawCap < 500000) return Math.round(rawCap / 1000) * 1000;
    return Math.round(rawCap / 10000) * 10000;
  }

  function capacityToSlider(capacity) {
    if (capacity <= SLIDER_MIN_CAP) return 0;
    if (capacity >= SLIDER_MAX_CAP) return 100;
    return ((Math.log(capacity) - SLIDER_MIN_LOG) / (SLIDER_MAX_LOG - SLIDER_MIN_LOG)) * 100;
  }

  // ===== STEP SKIPPING LOGIC =====
  // Step 2 (usage) is only needed for "andere"
  // Step 4 (nonprofit) is hidden for "stadion" (always commercial) and "club" (always nonprofit)
  function shouldSkipStep(step) {
    if (step === 2 && state.venueType !== 'andere') return true;
    if (step === 4 && (state.venueType === 'stadion' || state.venueType === 'club')) return true;
    return false;
  }

  function getNextStep(current) {
    var next = current + 1;
    while (next <= state.totalSteps && shouldSkipStep(next)) next++;
    return next <= state.totalSteps ? next : state.totalSteps;
  }

  function getPrevStep(current) {
    var prev = current - 1;
    while (prev >= 1 && shouldSkipStep(prev)) prev--;
    return prev >= 1 ? prev : 1;
  }

  // ===== FORMATTING =====
  function formatCurrency(num) {
    return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatNumber(num) {
    return num.toLocaleString('de-DE');
  }

  function formatPricePerPerson(num) {
    if (num < 0.01) {
      return num.toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    }
    return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ===== WIZARD NAVIGATION =====
  function goToStep(step) {
    if (step < 1 || step > state.totalSteps) return;

    // Hide current step
    var currentEl = document.querySelector('.pw-step.active');
    if (currentEl) currentEl.classList.remove('active');

    // Show target step
    var targetEl = document.querySelector('.pw-step[data-step="' + step + '"]');
    if (targetEl) targetEl.classList.add('active');

    // Update progress
    updateProgress(step);
    updateNavButtons(step);

    // Step-specific logic
    if (step === 3) configureSlider();
    if (step === 6) renderResult();

    state.currentStep = step;
  }

  function getVisibleStepCount() {
    var count = 0;
    for (var s = 1; s <= state.totalSteps; s++) {
      if (!shouldSkipStep(s)) count++;
    }
    return count;
  }

  function getVisibleStepIndex(step) {
    var idx = 0;
    for (var s = 1; s <= step; s++) {
      if (!shouldSkipStep(s)) idx++;
    }
    return idx;
  }

  function updateProgress(step) {
    var totalVisible = getVisibleStepCount();
    var currentIdx = getVisibleStepIndex(step);
    var pct = totalVisible > 1 ? ((currentIdx - 1) / (totalVisible - 1)) * 100 : 0;
    var fill = document.getElementById('pwProgressFill');
    if (fill) fill.style.width = pct + '%';

    // Step indicators - update based on visible steps
    var stepEls = document.querySelectorAll('.pw-progress-step');
    var visIdx = 0;
    for (var s = 1; s <= state.totalSteps; s++) {
      if (shouldSkipStep(s)) continue;
      visIdx++;
      if (visIdx <= stepEls.length) {
        stepEls[visIdx - 1].classList.remove('active', 'completed');
        if (s === step) stepEls[visIdx - 1].classList.add('active');
        else if (s < step) stepEls[visIdx - 1].classList.add('completed');
      }
    }
    // Hide extra step indicators
    for (var i = visIdx; i < stepEls.length; i++) {
      stepEls[i].classList.remove('active', 'completed');
      stepEls[i].style.display = 'none';
    }
    // Show used indicators
    for (var j = 0; j < visIdx && j < stepEls.length; j++) {
      stepEls[j].style.display = '';
      stepEls[j].setAttribute('data-step', j + 1);
      stepEls[j].textContent = j + 1;
    }
  }

  function updateNavButtons(step) {
    var backBtn = document.getElementById('pwBtnBack');
    var nextBtn = document.getElementById('pwBtnNext');
    var navEl = document.getElementById('pwNav');

    backBtn.style.display = step > 1 ? '' : 'none';
    navEl.style.display = step === state.totalSteps ? 'none' : '';
    nextBtn.disabled = !isStepComplete(step);
  }

  function isStepComplete(step) {
    switch (step) {
      case 1: return state.venueType !== null;
      case 2: return state.usage !== null;
      case 3: return true;
      case 4: return state.nonprofit !== null;
      case 5: return state.customCI !== null;
      default: return true;
    }
  }

  function configureSlider() {
    var descEl = document.getElementById('pwCapacityDesc');
    var titleEl = document.getElementById('pwCapacityTitle');
    if (!descEl) return;

    // Set default capacity for venue type
    var defaultCap = DEFAULT_CAPACITIES[state.venueType] || 5000;
    state.capacity = defaultCap;
    var slider = document.getElementById('pwCapacitySlider');
    if (slider) {
      slider.value = capacityToSlider(defaultCap);
    }
    updateSliderDisplay();

    if (state.venueType === 'club') {
      if (titleEl) titleEl.innerHTML = '<span data-lang-de>Kapazität</span><span data-lang-en>Capacity</span>';
      descEl.innerHTML = '<span data-lang-de>Wie viele Menschen passen maximal in eure Location?</span><span data-lang-en>What is the maximum capacity of your location?</span>';
    } else if (state.usage === 'dauerhaft') {
      if (titleEl) titleEl.innerHTML = '<span data-lang-de>Auslastung</span><span data-lang-en>Capacity</span>';
      descEl.innerHTML = '<span data-lang-de>Wie hoch ist die durchschnittliche Auslastung?</span><span data-lang-en>What is the average capacity?</span>';
    } else {
      if (titleEl) titleEl.innerHTML = '<span data-lang-de>Erwartete Besuchendenzahl</span><span data-lang-en>Expected Visitors</span>';
      descEl.innerHTML = '<span data-lang-de>Wie viele Besuchende erwartet ihr?</span><span data-lang-en>How many visitors do you expect?</span>';
    }
    applyLang();
  }

  // ===== RESULT RENDERING =====
  function renderResult() {
    var result = calculatePrice();
    var isDE = document.body.classList.contains('lang-de');

    // Price display
    document.getElementById('pwResultAmount').textContent = formatCurrency(result.annual);

    // Label
    var labelEl = document.getElementById('pwResultLabel');
    if (state.usage === 'dauerhaft') {
      labelEl.innerHTML = '<span data-lang-de>Gesamtpreis pro Jahr (exkl. MwSt.)</span><span data-lang-en>Total price per year (excl. VAT)</span>';
    } else {
      labelEl.innerHTML = '<span data-lang-de>Preis pro Veranstaltung (exkl. MwSt.)</span><span data-lang-en>Price per event (excl. VAT)</span>';
    }

    // Per-unit
    var perUnitEl = document.getElementById('pwResultPerUnit');
    if (state.usage === 'dauerhaft') {
      perUnitEl.innerHTML = '<span data-lang-de>Preis pro Person / Monat: ' + formatPricePerPerson(result.perPersonPerMonth) + ' \u20AC</span>' +
        '<span data-lang-en>Price per person / month: ' + formatPricePerPerson(result.perPersonPerMonth) + ' \u20AC</span>';
    } else {
      perUnitEl.innerHTML = '<span data-lang-de>' + formatPricePerPerson(result.perPersonPerMonth) + ' \u20AC pro Person</span>' +
        '<span data-lang-en>' + formatPricePerPerson(result.perPersonPerMonth) + ' \u20AC per person</span>';
    }

    // Summary table
    var typeLabels = {
      club: 'Club',
      stadion: 'Venue',
      stadtfest: 'Event',
      andere: isDE ? 'Andere' : 'Other'
    };
    document.getElementById('pwSummaryType').textContent = typeLabels[state.venueType] || '\u2013';
    document.getElementById('pwSummaryCapacity').textContent = formatNumber(state.capacity);
    document.getElementById('pwSummaryDesign').textContent = state.customCI
      ? (isDE ? 'Eigene CI' : 'Custom CI')
      : 'Standard';

    if (state.usage === 'dauerhaft') {
      var durationText = state.contractYears + ' ' + (state.contractYears === 1 ? (isDE ? 'Jahr' : 'Year') : (isDE ? 'Jahre' : 'Years'));
      document.getElementById('pwSummaryDuration').textContent = durationText;
    } else {
      document.getElementById('pwSummaryDuration').textContent = isDE ? 'Einmalig' : 'One-time';
    }

    // License fee line
    var licenseLabel = document.getElementById('pwSummaryLicenseLabel');
    if (state.usage === 'dauerhaft') {
      licenseLabel.innerHTML = '<span data-lang-de>Jahreslizenz</span><span data-lang-en>Annual license</span>';
    } else {
      licenseLabel.innerHTML = '<span data-lang-de>Lizenz (einmalig)</span><span data-lang-en>License (one-time)</span>';
    }
    document.getElementById('pwSummaryLicense').textContent = formatCurrency(result.annual) + ' \u20AC';

    // Setup fee line
    if (isSetupFeeFixed()) {
      document.getElementById('pwSummarySetup').textContent = formatCurrency(result.setupFee) + ' \u20AC';
    } else {
      document.getElementById('pwSummarySetup').textContent = (isDE ? 'ab ' : 'from ') + formatCurrency(result.setupFee) + ' \u20AC';
    }

    // Total line (license × years + setup)
    var years = state.usage === 'dauerhaft' ? state.contractYears : 1;
    var total = (result.annual * years) + result.setupFee;
    var totalLabel = document.getElementById('pwSummaryTotalLabel');
    if (state.usage === 'dauerhaft') {
      if (years === 1) {
        totalLabel.innerHTML = '<strong><span data-lang-de>Gesamt im 1. Jahr</span><span data-lang-en>Total in 1st year</span></strong>';
      } else {
        totalLabel.innerHTML = '<strong><span data-lang-de>Gesamt über ' + years + ' Jahre</span><span data-lang-en>Total over ' + years + ' years</span></strong>';
      }
    } else {
      totalLabel.innerHTML = '<strong><span data-lang-de>Gesamtkosten</span><span data-lang-en>Total cost</span></strong>';
    }
    if (isSetupFeeFixed()) {
      document.getElementById('pwSummaryTotal').textContent = formatCurrency(total) + ' \u20AC';
    } else {
      document.getElementById('pwSummaryTotal').textContent = (isDE ? 'ab ' : 'from ') + formatCurrency(total) + ' \u20AC';
    }

    // Show/hide contract toggle for dauerhaft only
    var contractSection = document.getElementById('pwContractSection');
    if (contractSection) {
      contractSection.style.display = state.usage === 'dauerhaft' ? '' : 'none';
    }

    applyLang();
  }

  function applyLang() {
    var lang = document.body.classList.contains('lang-en') ? 'en' : 'de';
    document.querySelectorAll('#pricingWizard [data-lang-de], #pricingWizard [data-lang-en]').forEach(function(el) {
      if (el.hasAttribute('data-lang-de')) {
        el.style.display = lang === 'de' ? '' : 'none';
      }
      if (el.hasAttribute('data-lang-en')) {
        el.style.display = lang === 'en' ? '' : 'none';
      }
    });
  }

  // ===== EVENT LISTENERS =====
  function init() {
    // Option card selection (Steps 1, 2, 4, 5)
    var allCards = document.querySelectorAll('.pw-option-card');
    for (var i = 0; i < allCards.length; i++) {
      allCards[i].addEventListener('click', handleCardClick);
    }

    // Slider
    var slider = document.getElementById('pwCapacitySlider');
    if (slider) {
      slider.addEventListener('input', handleSlider);
      state.capacity = sliderToCapacity(parseInt(slider.value));
      updateSliderDisplay();
    }

    // Contract toggle
    var toggleBtns = document.querySelectorAll('#pwContractToggle .pw-toggle-btn');
    for (var j = 0; j < toggleBtns.length; j++) {
      toggleBtns[j].addEventListener('click', handleContractToggle);
    }

    // Navigation
    document.getElementById('pwBtnNext').addEventListener('click', function() {
      goToStep(getNextStep(state.currentStep));
    });
    document.getElementById('pwBtnBack').addEventListener('click', function() {
      goToStep(getPrevStep(state.currentStep));
    });

    // Initial state
    updateNavButtons(1);
  }

  function handleCardClick() {
    var step = this.closest('.pw-step');
    if (!step) return;
    var stepNum = parseInt(step.getAttribute('data-step'));

    // Check for redirect (Städte & Kommunen)
    if (this.getAttribute('data-redirect')) {
      window.open(this.getAttribute('data-redirect'), '_blank');
      return;
    }

    // Deselect siblings
    var siblings = step.querySelectorAll('.pw-option-card');
    for (var i = 0; i < siblings.length; i++) {
      siblings[i].classList.remove('selected');
    }
    this.classList.add('selected');

    // Update state
    var value = this.getAttribute('data-value');
    switch (stepNum) {
      case 1:
        state.venueType = value;
        // Auto-set usage for known types
        if (DEFAULT_USAGE[value]) {
          state.usage = DEFAULT_USAGE[value];
        } else {
          state.usage = null; // reset for "andere"
        }
        // Auto-set nonprofit based on venue type
        if (value === 'club') {
          state.nonprofit = true;   // Club is always nonprofit
        } else if (value === 'stadion') {
          state.nonprofit = false;  // Stadion is always commercial
        } else {
          state.nonprofit = null;   // User selects in Step 4
        }
        break;
      case 2:
        state.usage = value === 'dauerhaft' ? 'dauerhaft' : 'einmalig';
        break;
      case 4:
        state.nonprofit = (value === 'nonprofit');
        break;
      case 5:
        state.customCI = (value === 'ci');
        break;
    }

    // Enable next button
    document.getElementById('pwBtnNext').disabled = false;

    // Auto-advance to next step after short delay (skip for slider step)
    setTimeout(function() {
      goToStep(getNextStep(state.currentStep));
    }, 250);
  }

  function updateSliderDisplay() {
    var isDE = !document.body.classList.contains('lang-en');
    var label;
    label = 'ca. ' + formatNumber(state.capacity);
    document.getElementById('pwSliderValue').textContent = label;
  }

  function handleSlider() {
    var position = parseInt(this.value);
    state.capacity = sliderToCapacity(position);
    updateSliderDisplay();
  }

  function handleContractToggle() {
    var btns = document.querySelectorAll('#pwContractToggle .pw-toggle-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.remove('active');
    }
    this.classList.add('active');
    state.contractYears = parseInt(this.getAttribute('data-years'));
    renderResult();
  }

  // ===== INIT =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
