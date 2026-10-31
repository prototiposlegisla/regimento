(function() {
  'use strict';

  // ===== DATA (injected by build.py) =====
  const SYSTEMATIC_INDEX = /*__SYSTEMATIC_INDEX__*/[];

  // The big ones come as JSON blocks before this script (<script
  // type="application/json">), read when first needed: JSON parses much
  // faster than a script's literals, and most of it is not needed to show
  // the page
  function pageData(id) {
    let value;
    return () => value || (value = JSON.parse(document.getElementById(id).textContent));
  }

  const SUBJECT_INDEX = pageData('data-subject-index')();   // the cards' index chips need it

  const referenciasIndex = pageData('data-referencias-index');

  const consultaIndex = pageData('data-consulta-index');

  const SUMMARIES_MAP = /*__SUMMARIES_MAP__*/{};

  // Notes of the correlates, each once; a badge carries its index (data-n)
  const correlatoNotas = pageData('data-correlato-notas');

  const INFO_HTML = /*__INFO_HTML__*/"";

  // ===== MINIMAP / TOOLTIP COLORS =====
  // The level colors come from style.css (:root --nivel-*), so a new palette
  // there reaches the minimap and its tooltips too
  const rootStyle = getComputedStyle(document.documentElement);
  const cssVar = name => rootStyle.getPropertyValue(name).trim();
  const MINIMAP_COLORS = {
    norma:   { bg: cssVar('--nivel-norma'),     text: '#fff' },
    tit:     { bg: cssVar('--nivel-titulo'),    text: '#fff' },
    cap:     { bg: cssVar('--nivel-capitulo'),  text: '#fff' },
    sec:     { bg: cssVar('--nivel-secao'),     text: cssVar('--nivel-secao-texto') },
    subsec:  { bg: cssVar('--nivel-subsecao'),  text: '#fff' },
    article: { bg: cssVar('--rubrica'),         text: '#fff' },
  };

  // ===== MARKER COLOR PALETTE (fixed order for auto-assignment) =====
  const MARKER_PALETTE = [
    { name: 'coral',    bg: '#ff6b6b', bgLight: '#ffe0e0', text: '#fff' },
    { name: 'sky',      bg: '#4dabf7', bgLight: '#d0ebff', text: '#fff' },
    { name: 'lime',     bg: '#51cf66', bgLight: '#d3f9d8', text: '#fff' },
    { name: 'amber',    bg: '#fcc419', bgLight: '#fff3bf', text: '#333' },
    { name: 'violet',   bg: '#9775fa', bgLight: '#e5dbff', text: '#fff' },
    { name: 'pink',     bg: '#f06595', bgLight: '#ffdeeb', text: '#fff' },
    { name: 'teal',     bg: '#20c997', bgLight: '#c3fae8', text: '#fff' },
    { name: 'orange',   bg: '#ff922b', bgLight: '#ffe8cc', text: '#fff' },
  ];

  // ===== STATE =====
  let selectedCard = null;
  let manualSelect = false;
  let markersList = [];
  let searchFilter = true;
  let currentSearch = '';
  // The chip in the search bar, whose articles the search runs within (one
  // at a time): a subject of the remissivo { kind: 'subject', label, refs },
  // or the marked articles { kind: 'markers', label }
  let scope = null;
  let scopeOpening = false;      // it was just put there (doSearch goes to its start)
  let scopeStartCard = null;     // and starts at this article (the one it was opened from)
  let zoomScale = 1;
  let zoomTimeout = null;
  let searchMatches = [];
  let searchIdx = 0;
  let indexMatches = null;   // the indexes' entries with the search terms (see searchIndexes)
  let currentRefCategory = 0;
  let markerTooltipTimer = null;
  let footnoteTooltipTimer = null;
  let scrollRafId = null;
  // The history's steps (see BACK AND FORWARD)
  const STEP_LOAD = Date.now().toString(36);
  let stepCount = 0;
  let stepId = STEP_LOAD + ':0';
  const steps = new Map();       // step id → the state kept when it was left
  const stepKinds = new Map();   // step id → what it opened ('drawer', 'panel'), or 'rem'
  let stepTaken = false;         // in this action
  let restoring = false;
  let silentPops = 0;            // backs that only take a step out
  let indexRenders = 0;          // the index panel drawn so many times

  // ===== DOM REFS =====
  const $cards = document.getElementById('cards-container');
  const $searchInput = document.getElementById('search-input');
  const $btnFilter = document.getElementById('btn-filter');
  const $btnClearSearch = document.getElementById('btn-clear-search');
  const $btnIndex = document.getElementById('btn-index');
  const $markerNav = document.getElementById('marker-nav');
  const $indexOverlay = document.getElementById('index-overlay');
  const $indexPanel = document.getElementById('index-panel');
  const $indexContent = document.getElementById('index-content');
  const $indexSearch = document.getElementById('index-search');
  const $searchChip = document.getElementById('search-chip');
  const $chipLabel = document.getElementById('chip-label');
  const $zoomIndicator = document.getElementById('zoom-indicator');
  const $searchNav = document.getElementById('search-nav');
  const $searchCounter = document.getElementById('search-counter');
  const $breadcrumb = document.getElementById('breadcrumb');
  const $searchTicks = document.getElementById('search-ticks');
  const $searchTickTooltip = document.getElementById('search-tick-tooltip');
  const $minimap = document.getElementById('minimap');
  const $minimapCanvas = document.getElementById('minimap-canvas');
  const $minimapViewport = document.getElementById('minimap-viewport');
  const $minimapTooltip = document.getElementById('minimap-tooltip');
  const $minimapHighlight = document.getElementById('minimap-highlight');
  const $markerTooltip = document.getElementById('marker-tooltip');
  const $footnoteTooltip = document.getElementById('footnote-tooltip');

  // Cards never get added or removed after load: query them once.
  // Callers must not mutate these arrays.
  const ALL_CARDS = Array.from($cards.querySelectorAll('.card'));
  const ARTICLE_CARDS = Array.from($cards.querySelectorAll('.card-artigo'));
  function getAllCards() {
    return ALL_CARDS;
  }
  function getArticleCards() {
    return ARTICLE_CARDS;
  }
  function visibleOnly(cards) {
    return cards.filter(c => !c.classList.contains('filtered-out'));
  }

