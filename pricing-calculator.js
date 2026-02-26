/**
 * saferspaces Pricing Calculator Wizard
 * Multi-step wizard for calculating custom pricing based on venue type, usage, capacity, etc.
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

  // Permanent usage: tiered per-person monthly pricing + base fee
  var PERMANENT_TIERS = [
    { from: 0,     to: 5000,   rate: 0.07 },
    { from: 5000,  to: 10000,  rate: 0.03 },
    { from: 10000, to: 30000,  rate: 0.01 },
    { from: 30000, to: 300000, rate: 0.01 }
  ];
  var PERMANENT_BASE_FEE = 10; // EUR/month

  // One-time events: tiered pricing, no base fee
  var EVENT_TIERS = [
    { from: 0,      to: 10000,   rate: 0.07 },
    { from: 10000,  to: 30000,   rate: 0.03 },
    { from: 30000,  to: 300000,  rate: 0.01 },
    { from: 300000, to: 1000000, rate: 0.01 },
    { from: 1000000, to: Infinity, rate: 0.00 }
  ];

  // Setup fees by capacity
  var SETUP_TIERS = [
    { maxCap: 500,    fee: 190 },
    { maxCap: 5000,   fee: 690 },
    { maxCap: 30000,  fee: 2630 },
    { maxCap: Infinity, fee: 3200 }
  ];

  // Modifiers
  var CI_MARKUP = 1.4;           // +40%
  var NONPROFIT_DISCOUNT = 0.8;  // -20%
  var CONTRACT_DISCOUNTS = { 1: 0, 2: 0.10, 3: 0.15 };

  function calcTieredPrice(capacity, tiers) {
    var price = 0;
    var remaining = capacity;
    for (var i = 0; i < tiers.length; i++) {
      if (remaining <= 0) break;
      var tierSize = tiers[i].to - tiers[i].from;
      var unitsInTier = Math.min(remaining, tierSize);
      price += unitsInTier * tiers[i].rate;
      remaining -= unitsInTier;
    }
    return price;
  }

  function calcSetupFee(capacity) {
    for (var i = 0; i < SETUP_TIERS.length; i++) {
      if (capacity <= SETUP_TIERS[i].maxCap) return SETUP_TIERS[i].fee;
    }
    return SETUP_TIERS[SETUP_TIERS.length - 1].fee;
  }

  function calculatePrice() {
    var basePrice;

    if (state.usage === 'dauerhaft') {
      var monthlyPrice = PERMANENT_BASE_FEE + calcTieredPrice(state.capacity, PERMANENT_TIERS);
      basePrice = monthlyPrice * 12;
    } else {
      basePrice = calcTieredPrice(state.capacity, EVENT_TIERS);
    }

    // Non-profit discount
    if (state.nonprofit) {
      basePrice *= NONPROFIT_DISCOUNT;
    }

    // Custom CI markup
    if (state.customCI) {
      basePrice *= CI_MARKUP;
    }

    // Contract length discount (only for dauerhaft)
    var discount = 0;
    if (state.usage === 'dauerhaft') {
      discount = CONTRACT_DISCOUNTS[state.contractYears] || 0;
      basePrice *= (1 - discount);
    }

    var setupFee = calcSetupFee(state.capacity);
    if (state.customCI) {
      setupFee *= CI_MARKUP;
    }

    var perPersonPerMonth;
    if (state.usage === 'dauerhaft') {
      perPersonPerMonth = basePrice / 12 / state.capacity;
    } else {
      perPersonPerMonth = basePrice / state.capacity;
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
    // position: 0-100
    var logVal = SLIDER_MIN_LOG + (position / 100) * (SLIDER_MAX_LOG - SLIDER_MIN_LOG);
    var rawCap = Math.exp(logVal);
    // Round to nice steps
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

  // ===== FORMATTING =====
  function formatCurrency(num) {
    return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatNumber(num) {
    return num.toLocaleString('de-DE');
  }

  function formatPricePerPerson(num) {
    return num.toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
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

  function updateProgress(step) {
    // Fill bar
    var pct = ((step - 1) / (state.totalSteps - 1)) * 100;
    var fill = document.getElementById('pwProgressFill');
    if (fill) fill.style.width = pct + '%';

    // Step indicators
    var steps = document.querySelectorAll('.pw-progress-step');
    for (var i = 0; i < steps.length; i++) {
      var s = parseInt(steps[i].getAttribute('data-step'));
      steps[i].classList.remove('active', 'completed');
      if (s === step) steps[i].classList.add('active');
      else if (s < step) steps[i].classList.add('completed');
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
    if (!descEl) return;

    if (state.usage === 'dauerhaft') {
      descEl.innerHTML = '<span data-lang-de>Wie hoch ist die durchschnittliche Auslastung?</span><span data-lang-en>What is the average capacity?</span>';
    } else {
      descEl.innerHTML = '<span data-lang-de>Wie viele Besuchende erwarten Sie?</span><span data-lang-en>How many visitors do you expect?</span>';
    }
    // Re-apply language
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
      perUnitEl.innerHTML = '<span data-lang-de>Preis pro Monat: ' + formatPricePerPerson(result.perPersonPerMonth) + ' \u20AC / Person</span>' +
        '<span data-lang-en>Price per month: ' + formatPricePerPerson(result.perPersonPerMonth) + ' \u20AC / person</span>';
    } else {
      perUnitEl.innerHTML = '<span data-lang-de>' + formatPricePerPerson(result.perPersonPerMonth) + ' \u20AC pro Person</span>' +
        '<span data-lang-en>' + formatPricePerPerson(result.perPersonPerMonth) + ' \u20AC per person</span>';
    }

    // Summary table
    var typeLabels = {
      club: 'Club',
      stadion: 'Stadion',
      stadtfest: 'Stadtfest',
      andere: 'Andere'
    };
    document.getElementById('pwSummaryType').textContent = typeLabels[state.venueType] || '–';
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

    document.getElementById('pwSummarySetup').textContent = formatCurrency(result.setupFee) + ' \u20AC';

    // Show/hide contract toggle for dauerhaft only
    var contractSection = document.getElementById('pwContractSection');
    if (contractSection) {
      contractSection.style.display = state.usage === 'dauerhaft' ? '' : 'none';
    }

    applyLang();
  }

  function applyLang() {
    // CSS rules handle lang visibility automatically via body class
    // This just forces re-evaluation for dynamically inserted content
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
      // Set initial value
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
      goToStep(state.currentStep + 1);
    });
    document.getElementById('pwBtnBack').addEventListener('click', function() {
      goToStep(state.currentStep - 1);
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
      case 1: state.venueType = value; break;
      case 2: state.usage = value; break;
      case 4: state.nonprofit = (value === 'nonprofit'); break;
      case 5: state.customCI = (value === 'ci'); break;
    }

    // Enable next button
    document.getElementById('pwBtnNext').disabled = false;
  }

  function updateSliderDisplay() {
    var isDE = !document.body.classList.contains('lang-en');
    var label = isDE ? 'ca. ' + formatNumber(state.capacity) + ' Besuchende' : 'approx. ' + formatNumber(state.capacity) + ' visitors';
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
