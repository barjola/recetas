/**
 * Recetario Monsieur Cuisine Connect & Smart
 * Aplicación Web moderna para visualización, filtrado por ingredientes y cocina guiada.
 */

(function () {
  'use strict';

  // ESTADO GLOBAL
  const state = {
    currentLanguage: 'es',     // Idioma activo: 'es' (predeterminado) o 'en'
    allRecipes: [],            // Catálogo ligero con ingredientes para filtrado
    fullRecipesMap: {},        // Caché de detalles completos por ID
    filteredRecipes: [],       // Recetas que cumplen los filtros actuales
    displayedCount: 24,        // Cantidad de tarjetas mostradas
    batchSize: 24,             // Incremento por lote
    categories: [],            // Categorías con conteos
    
    // Filtro por Ingredientes
    availableIngredients: [],  // [{ name, count }] ordenados por frecuencia
    selectedIngredients: new Set(), // Ingredientes seleccionados por el usuario
    ingredientSearchQuery: '', // Búsqueda dentro del popup de ingredientes
    
    // Filtros generales
    favorites: new Set(),
    showOnlyFavorites: false,
    activeCategory: 'all',
    searchQuery: '',
    difficulty: 'all',
    maxTime: 'all',
    device: 'all',
    sortBy: 'rating',

    // Modal de Receta
    currentRecipe: null,
    currentPortions: 4,
    originalPortions: 4,
    checkedIngredients: new Set(),

    // Temporizador flotante
    timer: {
      interval: null,
      totalSeconds: 0,
      remainingSeconds: 0,
      isRunning: false,
    }
  };

  // REFERENCIAS DOM
  const dom = {
    mainSearchInput: document.getElementById('mainSearchInput'),
    btnClearSearch: document.getElementById('btnClearSearch'),
    btnToggleTheme: document.getElementById('btnToggleTheme'),
    btnToggleFavorites: document.getElementById('btnToggleFavorites'),
    favCounterBadge: document.getElementById('favCounterBadge'),
    btnRandomRecipe: document.getElementById('btnRandomRecipe'),

    // Filtros
    filterLanguage: document.getElementById('filterLanguage'),
    filterDifficulty: document.getElementById('filterDifficulty'),
    filterTime: document.getElementById('filterTime'),
    filterDevice: document.getElementById('filterDevice'),
    filterSort: document.getElementById('filterSort'),
    categoriesContainer: document.getElementById('categoriesContainer'),
    activeFiltersRow: document.getElementById('activeFiltersRow'),
    activeFiltersBadges: document.getElementById('activeFiltersBadges'),
    btnResetFilters: document.getElementById('btnResetFilters'),

    // Botón y Badge de Ingredientes
    btnOpenIngredientsModal: document.getElementById('btnOpenIngredientsModal'),
    selectedIngredientsBadge: document.getElementById('selectedIngredientsBadge'),

    // Popup de Ingredientes
    ingredientsModal: document.getElementById('ingredientsModal'),
    btnCloseIngredientsModal: document.getElementById('btnCloseIngredientsModal'),
    ingredientSearchInput: document.getElementById('ingredientSearchInput'),
    btnClearIngredientSearch: document.getElementById('btnClearIngredientSearch'),
    selectedIngredientsContainer: document.getElementById('selectedIngredientsContainer'),
    availableIngredientsGrid: document.getElementById('availableIngredientsGrid'),
    availableIngredientsCount: document.getElementById('availableIngredientsCount'),
    btnClearAllIngredients: document.getElementById('btnClearAllIngredients'),
    btnApplyIngredients: document.getElementById('btnApplyIngredients'),
    btnApplyIngredientsText: document.getElementById('btnApplyIngredientsText'),

    // Grid y Resultados
    resultsTitle: document.getElementById('resultsTitle'),
    resultsCountBadge: document.getElementById('resultsCountBadge'),
    recipesGrid: document.getElementById('recipesGrid'),
    emptyState: document.getElementById('emptyState'),
    btnEmptyReset: document.getElementById('btnEmptyReset'),
    loadMoreSection: document.getElementById('loadMoreSection'),
    btnLoadMore: document.getElementById('btnLoadMore'),

    // Modal de Detalle de Receta
    recipeModal: document.getElementById('recipeModal'),
    recipeModalContent: document.getElementById('recipeModalContent'),

    // Temporizador
    floatingTimer: document.getElementById('floatingTimer'),
    timerDisplay: document.getElementById('timerDisplay'),
    timerProgressCircle: document.getElementById('timerProgressCircle'),
    btnTimerPlayPause: document.getElementById('btnTimerPlayPause'),
    timerIconPause: document.getElementById('timerIconPause'),
    timerIconPlay: document.getElementById('timerIconPlay'),
    btnTimerStop: document.getElementById('btnTimerStop'),
    timerAudio: document.getElementById('timerAudio'),

    // Notificaciones
    toastContainer: document.getElementById('toastContainer'),
  };

  // =========================================================================
  // INICIALIZACIÓN
  // =========================================================================

  async function init() {
    initTheme();
    loadFavoritesFromStorage();
    setupEventListeners();
    await loadRecipesData(state.currentLanguage);
    checkUrlHash();
    if (window.lucide) lucide.createIcons();
  }

  // Cargar catálogo de recetas según el idioma seleccionado
  async function loadRecipesData(lang = 'es') {
    renderLoadingSkeletons();
    state.fullRecipesMap = {};

    const indexFile = lang === 'es' ? 'data/recipes_es_index.json' : `data/recipes_${lang}_index.json`;
    const fallbackFile = 'data/recipes_index.json';
    const fullFile = lang === 'es' ? 'data/recipes_es.json' : `data/recipes_${lang}.json`;

    try {
      let response = await fetch(indexFile);
      if (!response.ok) {
        response = await fetch(fallbackFile);
      }
      const data = await response.json();
      state.allRecipes = data.recipes || [];

      // Extraer categorías e ingredientes disponibles del catálogo actual
      extractCategories(state.allRecipes);
      extractAvailableIngredients(state.allRecipes);

      renderCategories();
      applyFiltersAndSort();

      // Pre-cargar detalles completos en segundo plano
      loadFullRecipesInBackground(fullFile);

    } catch (err) {
      console.error('Error al cargar datos:', err);
      try {
        const fullResp = await fetch(fullFile);
        const fullData = await fullResp.json();
        state.allRecipes = fullData.recipes || [];
        for (const r of state.allRecipes) {
          state.fullRecipesMap[r.id] = r;
        }
        extractCategories(state.allRecipes);
        extractAvailableIngredients(state.allRecipes);
        renderCategories();
        applyFiltersAndSort();
      } catch (err2) {
        dom.recipesGrid.innerHTML = `
          <div class="col-span-full py-12 text-center text-rose-500">
            <p class="font-bold text-base mb-1">Error al conectar con los datos de recetas</p>
            <p class="text-xs text-slate-500">Comprueba tu conexión o recarga la página.</p>
          </div>
        `;
      }
    }
  }

  async function loadFullRecipesInBackground(filePath) {
    try {
      const resp = await fetch(filePath);
      if (!resp.ok) return;
      const data = await resp.json();
      for (const r of (data.recipes || [])) {
        state.fullRecipesMap[r.id] = r;
      }
    } catch (e) {
      console.warn('Carga en segundo plano pausada:', e);
    }
  }

  // =========================================================================
  // GESTIÓN DE INGREDIENTES DISPONIBLES (SOLO LOS QUE ESTÁN EN LAS RECETAS)
  // =========================================================================

  function extractAvailableIngredients(recipes) {
    const freqMap = new Map();

    for (const r of recipes) {
      const ings = r.ingredients || [];
      const seenInRecipe = new Set();
      for (const rawIng of ings) {
        const cleaned = normalizeIngredientName(rawIng);
        if (cleaned && !seenInRecipe.has(cleaned)) {
          seenInRecipe.add(cleaned);
          freqMap.set(cleaned, (freqMap.get(cleaned) || 0) + 1);
        }
      }
    }

    state.availableIngredients = Array.from(freqMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));

    const validNames = new Set(state.availableIngredients.map(i => i.name));
    for (const sel of Array.from(state.selectedIngredients)) {
      if (!validNames.has(sel)) {
        state.selectedIngredients.delete(sel);
      }
    }
    updateSelectedIngredientsBadge();
  }

  function normalizeIngredientName(str) {
    if (!str) return '';
    let s = str.trim().toLowerCase();
    s = s.replace(/\([^)]*\)/g, '').trim();
    s = s.replace(/^[\d.,\/\s]+(kg|g|mg|l|ml|cda|cdta|diente|dientes|pizca|chorrito|vaso|taza|unidad|unidades|trozo|trozos)?\.?\s+(de\s+)?/i, '').trim();
    s = s.replace(/\s{2,}/g, ' ');
    if (s.length < 2) return '';
    return s;
  }

  function renderIngredientsModal() {
    renderSelectedIngredientChips();
    renderAvailableIngredientPills();
    updateApplyButtonCount();
  }

  function renderSelectedIngredientChips() {
    const list = Array.from(state.selectedIngredients);
    if (list.length === 0) {
      dom.selectedIngredientsContainer.innerHTML = `
        <span class="text-[11px] text-slate-400 dark:text-slate-500 italic py-1">
          Ningún ingrediente seleccionado. Haz clic en los ingredientes de abajo para añadirlos.
        </span>
      `;
      return;
    }

    dom.selectedIngredientsContainer.innerHTML = list.map(ing => `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-brand-600 text-white shadow-sm animate-fade-in">
        <span>${escapeHtml(capitalize(ing))}</span>
        <button
          type="button"
          data-remove-ing="${escapeHtml(ing)}"
          class="btn-remove-ing w-4 h-4 rounded-full hover:bg-black/20 flex items-center justify-center ml-0.5 text-white/90"
        >
          &times;
        </button>
      </span>
    `).join('');

    dom.selectedIngredientsContainer.querySelectorAll('.btn-remove-ing').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ing = btn.getAttribute('data-remove-ing');
        state.selectedIngredients.delete(ing);
        renderIngredientsModal();
      });
    });
  }

  function renderAvailableIngredientPills() {
    const query = state.ingredientSearchQuery.toLowerCase().trim();
    
    const filtered = state.availableIngredients.filter(item => {
      if (!query) return true;
      return item.name.includes(query);
    });

    dom.availableIngredientsCount.textContent = `${filtered.length} ingredientes`;

    if (filtered.length === 0) {
      dom.availableIngredientsGrid.innerHTML = `
        <div class="w-full py-8 text-center text-xs text-slate-400">
          No se encontró ningún ingrediente con "<strong>${escapeHtml(query)}</strong>" en las recetas.
        </div>
      `;
      return;
    }

    const toShow = filtered.slice(0, 120);

    dom.availableIngredientsGrid.innerHTML = toShow.map(item => {
      const isSelected = state.selectedIngredients.has(item.name);

      return `
        <button
          type="button"
          data-ing="${escapeHtml(item.name)}"
          class="ing-pill px-3 py-1.5 rounded-xl text-xs font-medium transition-all select-none flex items-center gap-1.5 border ${
            isSelected
              ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-brand-400 hover:bg-orange-50 dark:hover:bg-slate-700'
          }"
        >
          <span class="text-xs">${isSelected ? '✓' : '+'}</span>
          <span>${escapeHtml(capitalize(item.name))}</span>
          <span class="text-[10px] opacity-60 ml-0.5">(${item.count})</span>
        </button>
      `;
    }).join('');

    dom.availableIngredientsGrid.querySelectorAll('.ing-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const ing = btn.getAttribute('data-ing');
        if (state.selectedIngredients.has(ing)) {
          state.selectedIngredients.delete(ing);
        } else {
          state.selectedIngredients.add(ing);
        }
        renderIngredientsModal();
      });
    });
  }

  function updateApplyButtonCount() {
    const count = state.selectedIngredients.size;
    if (count > 0) {
      dom.btnApplyIngredientsText.textContent = `Aplicar (${count} ingrediente${count > 1 ? 's' : ''})`;
    } else {
      dom.btnApplyIngredientsText.textContent = 'Ver todas las recetas';
    }
  }

  function updateSelectedIngredientsBadge() {
    const count = state.selectedIngredients.size;
    if (count > 0) {
      dom.selectedIngredientsBadge.textContent = count;
      dom.selectedIngredientsBadge.classList.remove('hidden');
      dom.btnOpenIngredientsModal.classList.add('bg-orange-100', 'border-brand-500', 'dark:bg-slate-800');
    } else {
      dom.selectedIngredientsBadge.classList.add('hidden');
      dom.btnOpenIngredientsModal.classList.remove('bg-orange-100', 'border-brand-500');
    }
  }

  function openIngredientsModal() {
    state.ingredientSearchQuery = '';
    if (dom.ingredientSearchInput) dom.ingredientSearchInput.value = '';
    dom.btnClearIngredientSearch?.classList.add('hidden');
    renderIngredientsModal();
    dom.ingredientsModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    setTimeout(() => dom.ingredientSearchInput?.focus(), 80);
  }

  function closeIngredientsModal() {
    dom.ingredientsModal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  // =========================================================================
  // GESTIÓN DE CATEGORÍAS
  // =========================================================================

  function extractCategories(recipes) {
    const counts = {};
    for (const r of recipes) {
      for (const cat of (r.categories || [])) {
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }
    state.categories = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }

  function renderCategories() {
    if (!dom.categoriesContainer) return;
    
    let html = `
      <button
        data-category="all"
        class="category-pill flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
          state.activeCategory === 'all'
            ? 'bg-brand-600 text-white shadow-sm shadow-brand-500/20'
            : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-brand-400'
        }"
      >
        Todas <span class="ml-1 opacity-70 text-[10px]">(${state.allRecipes.length})</span>
      </button>
    `;

    for (const cat of state.categories) {
      const isActive = state.activeCategory === cat.name;
      html += `
        <button
          data-category="${escapeHtml(cat.name)}"
          class="category-pill flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
            isActive
              ? 'bg-brand-600 text-white shadow-sm shadow-brand-500/20'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-brand-400'
          }"
        >
          ${escapeHtml(cat.name)} <span class="ml-1 opacity-70 text-[10px]">(${cat.count})</span>
        </button>
      `;
    }

    dom.categoriesContainer.innerHTML = html;

    dom.categoriesContainer.querySelectorAll('.category-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeCategory = btn.getAttribute('data-category');
        renderCategories();
        applyFiltersAndSort();
      });
    });
  }

  // =========================================================================
  // MOTOR DE BÚSQUEDA Y FILTRADO
  // =========================================================================

  function applyFiltersAndSort() {
    const query = state.searchQuery.toLowerCase().trim();
    const activeCat = state.activeCategory;
    const diff = state.difficulty;
    const maxT = state.maxTime === 'all' ? Infinity : parseInt(state.maxTime, 10);
    const dev = state.device;
    const onlyFavs = state.showOnlyFavorites;
    const requiredIngredients = Array.from(state.selectedIngredients);

    state.filteredRecipes = state.allRecipes.filter(r => {
      if (onlyFavs && !state.favorites.has(r.id)) {
        return false;
      }

      // Filtro por ingredientes seleccionados
      if (requiredIngredients.length > 0) {
        const recipeIngs = (r.ingredients || []).map(i => i.toLowerCase());
        const hasAll = requiredIngredients.every(req => {
          return recipeIngs.some(ing => ing.includes(req) || req.includes(ing));
        });
        if (!hasAll) return false;
      }

      // Búsqueda por texto (nombre, ingredientes, etiquetas)
      if (query) {
        const titleMatch = (r.title || '').toLowerCase().includes(query);
        const tagsMatch = (r.tags || []).some(t => t.toLowerCase().includes(query));
        const catMatch = (r.categories || []).some(c => c.toLowerCase().includes(query));
        const ingMatch = (r.ingredients || []).some(i => i.toLowerCase().includes(query));
        if (!titleMatch && !tagsMatch && !catMatch && !ingMatch) {
          return false;
        }
      }

      // Categoría
      if (activeCat !== 'all' && !(r.categories || []).includes(activeCat)) {
        return false;
      }

      // Dificultad
      if (diff !== 'all' && r.difficulty !== parseInt(diff, 10)) {
        return false;
      }

      // Tiempo máximo
      if (maxT !== Infinity) {
        const time = r.totalTime || r.prepTime || 0;
        if (time > maxT) return false;
      }

      // Dispositivo
      if (dev !== 'all' && !(r.devices || []).includes(dev)) {
        return false;
      }

      return true;
    });

    sortRecipes(state.filteredRecipes, state.sortBy);

    state.displayedCount = state.batchSize;
    updateSelectedIngredientsBadge();
    renderActiveFilterBadges();
    renderGrid();
    updateResultsHeader();
  }

  function sortRecipes(list, sortBy) {
    switch (sortBy) {
      case 'rating':
        list.sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.ratingCount || 0) - (a.ratingCount || 0));
        break;
      case 'popularity':
        list.sort((a, b) => (b.ratingCount || 0) - (a.ratingCount || 0) || (b.rating || 0) - (a.rating || 0));
        break;
      case 'fastest':
        list.sort((a, b) => {
          const tA = a.totalTime || a.prepTime || 999;
          const tB = b.totalTime || b.prepTime || 999;
          return tA - tB;
        });
        break;
      case 'title_asc':
        list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'es'));
        break;
      case 'title_desc':
        list.sort((a, b) => (b.title || '').localeCompare(a.title || '', 'es'));
        break;
    }
  }

  function renderActiveFilterBadges() {
    const badges = [];

    if (state.selectedIngredients.size > 0) {
      for (const ing of state.selectedIngredients) {
        badges.push({
          label: `🥕 ${capitalize(ing)}`,
          onRemove: () => {
            state.selectedIngredients.delete(ing);
            applyFiltersAndSort();
          }
        });
      }
    }

    if (state.showOnlyFavorites) {
      badges.push({ label: 'Mis Favoritas', onRemove: () => toggleFavoritesFilter(false) });
    }
    if (state.searchQuery) {
      badges.push({ label: `"${state.searchQuery}"`, onRemove: () => clearSearch() });
    }
    if (state.activeCategory !== 'all') {
      badges.push({ label: state.activeCategory, onRemove: () => { state.activeCategory = 'all'; renderCategories(); applyFiltersAndSort(); } });
    }
    if (state.difficulty !== 'all') {
      const dLabels = { '1': 'Fácil', '2': 'Media', '3': 'Difícil' };
      badges.push({ label: dLabels[state.difficulty] || 'Dificultad', onRemove: () => { state.difficulty = 'all'; dom.filterDifficulty.value = 'all'; applyFiltersAndSort(); } });
    }
    if (state.maxTime !== 'all') {
      badges.push({ label: `≤ ${state.maxTime} min`, onRemove: () => { state.maxTime = 'all'; dom.filterTime.value = 'all'; applyFiltersAndSort(); } });
    }
    if (state.device !== 'all') {
      badges.push({ label: state.device === 'MC2.0' ? 'MC Connect' : 'MC Smart', onRemove: () => { state.device = 'all'; dom.filterDevice.value = 'all'; applyFiltersAndSort(); } });
    }

    if (badges.length > 0) {
      dom.activeFiltersRow.classList.remove('hidden');
      dom.activeFiltersBadges.innerHTML = badges.map((b, idx) => `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-50 text-brand-700 dark:bg-slate-800 dark:text-brand-300 border border-orange-200 dark:border-slate-700">
          <span>${escapeHtml(b.label)}</span>
          <button data-idx="${idx}" class="remove-filter-btn hover:text-brand-900 dark:hover:text-white ml-0.5">
            &times;
          </button>
        </span>
      `).join('');

      dom.activeFiltersBadges.querySelectorAll('.remove-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          if (badges[idx]) badges[idx].onRemove();
        });
      });
    } else {
      dom.activeFiltersRow.classList.add('hidden');
      dom.activeFiltersBadges.innerHTML = '';
    }
  }

  function updateResultsHeader() {
    const total = state.filteredRecipes.length;
    dom.resultsCountBadge.textContent = total.toLocaleString('es-ES');

    if (state.selectedIngredients.size > 0) {
      dom.resultsTitle.textContent = `Recetas con tus ingredientes`;
    } else if (state.showOnlyFavorites) {
      dom.resultsTitle.textContent = 'Mis Recetas Favoritas';
    } else if (state.searchQuery) {
      dom.resultsTitle.textContent = `Resultados para "${state.searchQuery}"`;
    } else if (state.activeCategory !== 'all') {
      dom.resultsTitle.textContent = state.activeCategory;
    } else {
      dom.resultsTitle.textContent = 'Todas las Recetas';
    }
  }

  // =========================================================================
  // RENDERIZADO DEL GRID DE RECETAS
  // =========================================================================

  function renderGrid() {
    const total = state.filteredRecipes.length;

    if (total === 0) {
      dom.recipesGrid.innerHTML = '';
      dom.emptyState.classList.remove('hidden');
      dom.loadMoreSection.classList.add('hidden');
      return;
    }

    dom.emptyState.classList.add('hidden');

    const toShow = state.filteredRecipes.slice(0, state.displayedCount);
    dom.recipesGrid.innerHTML = toShow.map(recipe => createRecipeCardHtml(recipe)).join('');

    if (state.displayedCount < total) {
      dom.loadMoreSection.classList.remove('hidden');
    } else {
      dom.loadMoreSection.classList.add('hidden');
    }

    if (window.lucide) lucide.createIcons();
    attachCardEvents();
  }

  function createRecipeCardHtml(recipe) {
    const isFav = state.favorites.has(recipe.id);
    const duration = recipe.totalTime || recipe.prepTime || 0;
    const diffBadge = getDifficultyBadge(recipe.difficulty);
    const rating = recipe.rating || 0;
    const ratingCount = recipe.ratingCount || 0;
    const category = (recipe.categories && recipe.categories[0]) || 'Monsieur Cuisine';
    const imgSrc = recipe.image || '';
    const imgPlaceholder = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260" fill="%23f1f5f9"><rect width="100%" height="100%"/><text x="50%" y="50%" font-family="sans-serif" font-size="14" fill="%2394a3b8" text-anchor="middle" dy=".3em">Monsieur Cuisine</text></svg>`;

    return `
      <article
        data-id="${recipe.id}"
        class="recipe-card group relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-sm hover:shadow-xl hover:border-brand-500/40 dark:hover:border-brand-500/40 transition-all flex flex-col overflow-hidden cursor-pointer"
      >
        <div class="relative w-full aspect-[4/3] bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <img
            src="${imgSrc}"
            alt="${escapeHtml(recipe.title)}"
            loading="lazy"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onerror="this.onerror=null; this.src='${imgPlaceholder}';"
          >
          <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

          <button
            data-fav-id="${recipe.id}"
            class="fav-card-btn absolute top-3 right-3 p-2 rounded-full backdrop-blur-md transition-all ${
              isFav
                ? 'bg-rose-500 text-white shadow-md'
                : 'bg-white/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-300 hover:text-rose-500'
            }"
            title="${isFav ? 'Quitar de favoritas' : 'Guardar en favoritas'}"
          >
            <i data-lucide="heart" class="w-4 h-4 ${isFav ? 'fill-current' : ''}"></i>
          </button>

          <span class="absolute bottom-3 left-3 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white/90 dark:bg-slate-900/90 backdrop-blur-md text-slate-800 dark:text-slate-200 shadow-sm">
            ${escapeHtml(category)}
          </span>
        </div>

        <div class="p-4 flex-1 flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-1.5 text-xs mb-2">
              <div class="flex items-center text-amber-500">
                <i data-lucide="star" class="w-3.5 h-3.5 fill-current"></i>
                <span class="font-bold ml-1 text-slate-800 dark:text-slate-200">${rating > 0 ? rating.toFixed(1) : '-'}</span>
              </div>
              ${ratingCount > 0 ? `<span class="text-slate-400 text-[11px]">(${ratingCount})</span>` : ''}
              <span class="text-slate-300 dark:text-slate-700">&bull;</span>
              <span class="text-[11px] font-medium text-slate-500 dark:text-slate-400">${diffBadge}</span>
            </div>

            <h3 class="font-heading font-bold text-base text-slate-900 dark:text-white group-hover:text-brand-600 dark:hover:text-brand-400 transition-colors line-clamp-2 leading-snug">
              ${escapeHtml(recipe.title)}
            </h3>
          </div>

          <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <div class="flex items-center gap-1.5 font-medium">
              <i data-lucide="clock" class="w-3.5 h-3.5 text-brand-500"></i>
              <span>${duration > 0 ? `${duration} min` : 'Rápida'}</span>
            </div>
            <div class="flex items-center gap-1 text-[11px]">
              <i data-lucide="users" class="w-3.5 h-3.5 text-slate-400"></i>
              <span>${recipe.portions || 4} ${recipe.portionUnit || 'raciones'}</span>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function getDifficultyBadge(level) {
    switch (level) {
      case 1: return '🟢 Fácil';
      case 2: return '🟡 Media';
      case 3: return '🔴 Difícil';
      default: return '🟢 Fácil';
    }
  }

  function attachCardEvents() {
    dom.recipesGrid.querySelectorAll('.recipe-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.fav-card-btn')) return;
        const id = parseInt(card.getAttribute('data-id'), 10);
        openRecipeModal(id);
      });
    });

    dom.recipesGrid.querySelectorAll('.fav-card-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.getAttribute('data-fav-id'), 10);
        toggleFavorite(id);
      });
    });
  }

  function renderLoadingSkeletons() {
    const skeletons = Array(8).fill(0).map(() => `
      <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-pulse">
        <div class="w-full aspect-[4/3] bg-slate-200 dark:bg-slate-800"></div>
        <div class="p-4 space-y-3">
          <div class="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/3"></div>
          <div class="h-5 bg-slate-200 dark:bg-slate-800 rounded w-3/4"></div>
          <div class="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/2"></div>
        </div>
      </div>
    `).join('');
    dom.recipesGrid.innerHTML = skeletons;
  }

  // =========================================================================
  // MODAL DE DETALLE DE RECETA
  // =========================================================================

  async function openRecipeModal(recipeId) {
    let recipe = state.fullRecipesMap[recipeId];

    if (!recipe || !recipe.steps) {
      showModalLoading();
      try {
        const fullFile = state.currentLanguage === 'es' ? 'data/recipes_es.json' : `data/recipes_${state.currentLanguage}.json`;
        const resp = await fetch(fullFile);
        const data = await resp.json();
        for (const r of (data.recipes || [])) {
          state.fullRecipesMap[r.id] = r;
        }
        recipe = state.fullRecipesMap[recipeId];
      } catch (e) {
        console.error('Error al abrir receta:', e);
      }
    }

    if (!recipe) {
      showToast('No se pudo abrir la receta seleccionada.', 'error');
      return;
    }

    state.currentRecipe = recipe;
    state.originalPortions = recipe.portions || 4;
    state.currentPortions = state.originalPortions;
    state.checkedIngredients.clear();

    window.location.hash = `recipe/${recipe.id}`;
    renderRecipeModalContent();
    dom.recipeModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');

    if (window.lucide) lucide.createIcons();
  }

  function showModalLoading() {
    dom.recipeModalContent.innerHTML = `
      <div class="p-12 text-center">
        <div class="inline-block w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p class="text-xs text-slate-500 dark:text-slate-400">Cargando receta completa...</p>
      </div>
    `;
    dom.recipeModal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }

  function closeRecipeModal() {
    dom.recipeModal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    state.currentRecipe = null;
    if (window.location.hash.startsWith('#recipe/')) {
      history.pushState(null, '', window.location.pathname + window.location.search);
    }
  }

  function renderRecipeModalContent() {
    const r = state.currentRecipe;
    if (!r) return;

    const isFav = state.favorites.has(r.id);
    const duration = r.totalTime || r.prepTime || 0;
    const diffBadge = getDifficultyBadge(r.difficulty);
    const imgSrc = r.image || '';

    dom.recipeModalContent.innerHTML = `
      <div class="relative w-full h-60 sm:h-72 bg-slate-900 overflow-hidden">
        <img
          src="${imgSrc}"
          alt="${escapeHtml(r.title)}"
          class="w-full h-full object-cover opacity-85"
          onerror="this.style.display='none';"
        >
        <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>

        <button
          id="btnModalClose"
          class="absolute top-4 right-4 p-2 rounded-full bg-black/40 hover:bg-black/70 text-white backdrop-blur-md transition-colors"
          title="Cerrar (Esc)"
        >
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>

        <div class="absolute bottom-5 left-5 right-5 text-white">
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-600/90 backdrop-blur-md">
              ${escapeHtml(r.categories[0] || 'Monsieur Cuisine')}
            </span>
            <span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-black/50 backdrop-blur-md">
              ${diffBadge}
            </span>
          </div>

          <h2 class="font-heading font-extrabold text-2xl sm:text-3xl text-white tracking-tight drop-shadow-sm leading-snug">
            ${escapeHtml(r.title)}
          </h2>

          <div class="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-200">
            <div class="flex items-center gap-1.5">
              <i data-lucide="clock" class="w-4 h-4 text-brand-400"></i>
              <span>Total: <strong>${duration} min</strong> (Prep: ${r.prepTime || 0} min)</span>
            </div>
            <div class="flex items-center gap-1.5">
              <i data-lucide="star" class="w-4 h-4 text-amber-400 fill-current"></i>
              <span><strong>${r.rating > 0 ? r.rating.toFixed(1) : '-'}</strong> (${r.ratingCount || 0} valoraciones)</span>
            </div>
          </div>
        </div>
      </div>

      <div class="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2">
          <button
            id="btnModalFav"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              isFav
                ? 'bg-rose-500 text-white'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-rose-500 border border-slate-200 dark:border-slate-700'
            }"
          >
            <i data-lucide="heart" class="w-4 h-4 ${isFav ? 'fill-current' : ''}"></i>
            <span>${isFav ? 'Guardada' : 'Favorita'}</span>
          </button>

          <button
            id="btnModalShare"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors"
          >
            <i data-lucide="share-2" class="w-4 h-4 text-brand-500"></i>
            <span>Compartir</span>
          </button>

          <button
            id="btnModalPrint"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors"
          >
            <i data-lucide="printer" class="w-4 h-4 text-slate-500"></i>
            <span>Imprimir</span>
          </button>
        </div>

        <a
          href="${r.url || '#'}"
          target="_blank"
          rel="noopener"
          class="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1 font-medium ml-auto"
        >
          <span>Ficha oficial</span>
          <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
        </a>
      </div>

      <div class="p-5 sm:p-7 space-y-6 max-h-[calc(85vh-200px)] overflow-y-auto">
        
        ${r.description ? `
          <div class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed bg-orange-50/40 dark:bg-slate-800/40 p-3.5 rounded-2xl border border-orange-100/70 dark:border-slate-800">
            ${escapeHtml(r.description).replace(/\n/g, '<br>')}
          </div>
        ` : ''}

        <!-- INGREDIENTES CON ESCALADOR -->
        <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm">
          <div class="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 class="font-heading font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <i data-lucide="utensils" class="w-4 h-4 text-brand-500"></i>
                <span>Ingredientes</span>
              </h3>
            </div>

            <div class="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-xl">
              <span class="text-xs font-medium text-slate-500 dark:text-slate-400 mr-1">Raciones:</span>
              <button
                id="btnPortionMinus"
                class="w-6 h-6 rounded-lg bg-white dark:bg-slate-700 shadow-sm flex items-center justify-center font-bold text-slate-700 dark:text-slate-200 hover:bg-brand-500 hover:text-white"
              >-</button>
              <span id="portionDisplay" class="font-heading font-bold text-sm w-5 text-center text-brand-600 dark:text-brand-400">
                ${state.currentPortions}
              </span>
              <button
                id="btnPortionPlus"
                class="w-6 h-6 rounded-lg bg-white dark:bg-slate-700 shadow-sm flex items-center justify-center font-bold text-slate-700 dark:text-slate-200 hover:bg-brand-500 hover:text-white"
              >+</button>
            </div>
          </div>

          <div id="ingredientsListContainer" class="space-y-4">
            ${renderScaledIngredientsHtml()}
          </div>
        </div>

        <!-- PASOS CON AJUSTES DE MONSIEUR CUISINE -->
        <div>
          <h3 class="font-heading font-bold text-lg text-slate-900 dark:text-white mb-3 flex items-center gap-2">
            <i data-lucide="list-ordered" class="w-5 h-5 text-brand-500"></i>
            <span>Instrucciones paso a paso</span>
          </h3>

          <div class="space-y-3.5">
            ${renderStepsHtml(r.steps || [])}
          </div>
        </div>

        ${r.tips ? `
          <div class="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-4 text-xs sm:text-sm">
            <h4 class="font-heading font-bold text-amber-900 dark:text-amber-300 flex items-center gap-2 mb-1">
              <i data-lucide="lightbulb" class="w-4 h-4 text-amber-600"></i>
              <span>Consejos del chef</span>
            </h4>
            <p class="text-amber-800 dark:text-amber-200/90 leading-relaxed whitespace-pre-line">
              ${escapeHtml(r.tips)}
            </p>
          </div>
        ` : ''}

      </div>
    `;

    document.getElementById('btnModalClose').addEventListener('click', closeRecipeModal);
    document.getElementById('btnModalFav').addEventListener('click', () => {
      toggleFavorite(r.id);
      renderRecipeModalContent();
    });
    document.getElementById('btnModalShare').addEventListener('click', shareCurrentRecipe);
    document.getElementById('btnModalPrint').addEventListener('click', () => window.print());

    document.getElementById('btnPortionMinus').addEventListener('click', () => {
      if (state.currentPortions > 1) {
        state.currentPortions -= 1;
        document.getElementById('portionDisplay').textContent = state.currentPortions;
        document.getElementById('ingredientsListContainer').innerHTML = renderScaledIngredientsHtml();
        attachIngredientCheckEvents();
      }
    });

    document.getElementById('btnPortionPlus').addEventListener('click', () => {
      if (state.currentPortions < 24) {
        state.currentPortions += 1;
        document.getElementById('portionDisplay').textContent = state.currentPortions;
        document.getElementById('ingredientsListContainer').innerHTML = renderScaledIngredientsHtml();
        attachIngredientCheckEvents();
      }
    });

    attachIngredientCheckEvents();
    attachStepTimerEvents();
  }

  function renderScaledIngredientsHtml() {
    const r = state.currentRecipe;
    if (!r || !r.ingredients) return '<p class="text-xs text-slate-400">Sin ingredientes registrados.</p>';

    const ratio = state.currentPortions / (state.originalPortions || 4);

    return r.ingredients.map((group, gIdx) => `
      <div class="space-y-1">
        ${group.title ? `
          <h4 class="font-bold text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mt-2 mb-1">
            ${escapeHtml(group.title)}
          </h4>
        ` : ''}
        <ul class="divide-y divide-slate-100 dark:divide-slate-800/60">
          ${group.items.map((item, iIdx) => {
            const ingKey = `${gIdx}-${iIdx}`;
            const isChecked = state.checkedIngredients.has(ingKey);
            const scaledQty = scaleQuantity(item.qty, ratio);

            return `
              <li
                data-ing-key="${ingKey}"
                class="ingredient-item py-1.5 px-1 flex items-center justify-between text-xs sm:text-sm cursor-pointer select-none rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                  isChecked ? 'checked opacity-50' : ''
                }"
              >
                <div class="flex items-center gap-2.5">
                  <div class="w-4 h-4 rounded border flex items-center justify-center ${
                    isChecked
                      ? 'bg-brand-500 border-brand-500 text-white'
                      : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                  }">
                    ${isChecked ? '✓' : ''}
                  </div>
                  <span class="text-slate-800 dark:text-slate-200">
                    ${escapeHtml(item.name)}
                    ${item.note ? `<span class="text-[11px] text-slate-400 italic">(${escapeHtml(item.note)})</span>` : ''}
                  </span>
                </div>
                <div class="font-bold text-slate-900 dark:text-white font-mono text-xs whitespace-nowrap ml-4">
                  ${scaledQty ? `${scaledQty} ` : ''}${escapeHtml(item.unit || '')}
                </div>
              </li>
            `;
          }).join('')}
        </ul>
      </div>
    `).join('');
  }

  function scaleQuantity(rawQty, ratio) {
    if (!rawQty) return '';
    const num = parseFloat(rawQty.replace(',', '.'));
    if (isNaN(num)) return rawQty;
    const scaled = num * ratio;
    if (scaled % 1 === 0) return scaled.toString();
    if (scaled < 10) return scaled.toFixed(1).replace('.0', '');
    return Math.round(scaled).toString();
  }

  function attachIngredientCheckEvents() {
    document.querySelectorAll('.ingredient-item').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-ing-key');
        if (state.checkedIngredients.has(key)) {
          state.checkedIngredients.delete(key);
        } else {
          state.checkedIngredients.add(key);
        }
        document.getElementById('ingredientsListContainer').innerHTML = renderScaledIngredientsHtml();
        attachIngredientCheckEvents();
      });
    });
  }

  function renderStepsHtml(steps) {
    if (!steps || steps.length === 0) {
      return '<p class="text-xs text-slate-400">Sin pasos detallados.</p>';
    }

    return steps.map((s, idx) => {
      const hasSettings = s.settings && s.settings.length > 0;

      return `
        <div class="bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 space-y-2.5">
          <div class="flex items-start gap-3">
            <span class="flex-shrink-0 w-6 h-6 rounded-lg bg-brand-600 text-white font-heading font-bold text-xs flex items-center justify-center">
              ${idx + 1}
            </span>
            <div class="flex-1 text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed pt-0.5 whitespace-pre-line">
              ${escapeHtml(s.text)}
            </div>
          </div>

          ${hasSettings ? `
            <div class="ml-9 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
              <div class="flex flex-wrap items-center gap-1.5">
                ${s.settings.map(st => createRobotSettingBadge(st)).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function createRobotSettingBadge(st) {
    const badges = [];

    if (st.mode === 'scale' || st.weight > 0) {
      return `
        <div class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <i data-lucide="scale" class="w-3.5 h-3.5 text-emerald-500"></i>
          <span>Báscula: ${st.weight} g</span>
        </div>
      `;
    }

    if (st.mode_name && st.mode_name !== 'Manual') {
      badges.push(`
        <span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
          <i data-lucide="cog" class="w-3 h-3 text-purple-500"></i>
          <span>${escapeHtml(st.mode_name)}</span>
        </span>
      `);
    }

    if (st.time_sec > 0) {
      badges.push(`
        <button
          data-time-seconds="${st.time_sec}"
          class="step-timer-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 transition-colors"
          title="Iniciar temporizador"
        >
          <i data-lucide="timer" class="w-3.5 h-3.5 text-amber-500"></i>
          <span>${escapeHtml(st.time_formatted || `${st.time_sec} s`)}</span>
          <span class="text-[10px] ml-0.5 bg-amber-200 dark:bg-amber-900 px-1 rounded text-amber-800 dark:text-amber-200">▶</span>
        </button>
      `);
    }

    if (st.speed !== undefined && st.speed > 0) {
      badges.push(`
        <span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
          <i data-lucide="zap" class="w-3 h-3 text-blue-500"></i>
          <span>Vel. ${st.speed}</span>
        </span>
      `);
    }

    if (st.temperature > 0) {
      badges.push(`
        <span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
          <i data-lucide="thermometer" class="w-3.5 h-3.5 text-rose-500"></i>
          <span>${st.temperature} °C</span>
        </span>
      `);
    }

    if (st.reverse) {
      badges.push(`
        <span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
          <i data-lucide="rotate-ccw" class="w-3.5 h-3.5 text-indigo-500"></i>
          <span>Inverso</span>
        </span>
      `);
    }

    return badges.join('');
  }

  function attachStepTimerEvents() {
    document.querySelectorAll('.step-timer-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const seconds = parseInt(btn.getAttribute('data-time-seconds'), 10);
        if (seconds > 0) startTimer(seconds);
      });
    });
  }

  // =========================================================================
  // TEMPORIZADOR FLOTANTE DE COCINA
  // =========================================================================

  function startTimer(seconds) {
    stopTimer();
    state.timer.totalSeconds = seconds;
    state.timer.remainingSeconds = seconds;
    state.timer.isRunning = true;

    dom.floatingTimer.classList.remove('hidden');
    updateTimerDisplay();

    state.timer.interval = setInterval(() => {
      if (state.timer.remainingSeconds > 0) {
        state.timer.remainingSeconds -= 1;
        updateTimerDisplay();
      } else {
        finishTimer();
      }
    }, 1000);

    showToast(`Temporizador iniciado (${formatTime(seconds)})`, 'info');
  }

  function updateTimerDisplay() {
    const mins = Math.floor(state.timer.remainingSeconds / 60);
    const secs = state.timer.remainingSeconds % 60;
    dom.timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (dom.timerProgressCircle && state.timer.totalSeconds > 0) {
      const progress = state.timer.remainingSeconds / state.timer.totalSeconds;
      const offset = 125.6 * (1 - progress);
      dom.timerProgressCircle.style.strokeDashoffset = offset;
    }
  }

  function toggleTimerPlayPause() {
    if (state.timer.isRunning) {
      clearInterval(state.timer.interval);
      state.timer.isRunning = false;
      dom.timerIconPause.classList.add('hidden');
      dom.timerIconPlay.classList.remove('hidden');
    } else {
      state.timer.isRunning = true;
      dom.timerIconPlay.classList.add('hidden');
      dom.timerIconPause.classList.remove('hidden');
      state.timer.interval = setInterval(() => {
        if (state.timer.remainingSeconds > 0) {
          state.timer.remainingSeconds -= 1;
          updateTimerDisplay();
        } else {
          finishTimer();
        }
      }, 1000);
    }
  }

  function stopTimer() {
    if (state.timer.interval) {
      clearInterval(state.timer.interval);
      state.timer.interval = null;
    }
    state.timer.isRunning = false;
    dom.floatingTimer.classList.add('hidden');
  }

  function finishTimer() {
    stopTimer();
    showToast('🔔 ¡Tiempo de cocción finalizado!', 'success');
    if (dom.timerAudio) {
      dom.timerAudio.currentTime = 0;
      dom.timerAudio.play().catch(() => {});
    }
  }

  function formatTime(totalSec) {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins === 0) return `${secs} seg`;
    if (secs === 0) return `${mins} min`;
    return `${mins} min ${secs} s`;
  }

  // =========================================================================
  // SISTEMA DE FAVORITAS
  // =========================================================================

  function loadFavoritesFromStorage() {
    try {
      const saved = localStorage.getItem('mc_recipes_favorites');
      if (saved) {
        state.favorites = new Set(JSON.parse(saved));
      }
    } catch (e) {
      state.favorites = new Set();
    }
    updateFavoritesBadge();
  }

  function saveFavoritesToStorage() {
    try {
      localStorage.setItem('mc_recipes_favorites', JSON.stringify(Array.from(state.favorites)));
    } catch (e) {}
    updateFavoritesBadge();
  }

  function toggleFavorite(id) {
    if (state.favorites.has(id)) {
      state.favorites.delete(id);
      showToast('Eliminada de favoritas');
    } else {
      state.favorites.add(id);
      showToast('Añadida a favoritas ⭐');
    }
    saveFavoritesToStorage();
    renderGrid();
  }

  function updateFavoritesBadge() {
    const count = state.favorites.size;
    if (count > 0) {
      dom.favCounterBadge.textContent = count;
      dom.favCounterBadge.classList.remove('hidden');
    } else {
      dom.favCounterBadge.classList.add('hidden');
    }
  }

  function toggleFavoritesFilter(forceState) {
    if (typeof forceState === 'boolean') {
      state.showOnlyFavorites = forceState;
    } else {
      state.showOnlyFavorites = !state.showOnlyFavorites;
    }

    if (state.showOnlyFavorites) {
      dom.btnToggleFavorites.classList.add('bg-rose-100', 'text-rose-700', 'dark:bg-rose-950', 'dark:text-rose-300');
    } else {
      dom.btnToggleFavorites.classList.remove('bg-rose-100', 'text-rose-700', 'dark:bg-rose-950', 'dark:text-rose-300');
    }

    applyFiltersAndSort();
  }

  // =========================================================================
  // TEMA (DARK / LIGHT MODE)
  // =========================================================================

  function initTheme() {
    const savedTheme = localStorage.getItem('mc_theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('mc_theme', isDark ? 'dark' : 'light');
    if (window.lucide) lucide.createIcons();
  }

  // =========================================================================
  // EVENT LISTENERS
  // =========================================================================

  function setupEventListeners() {
    dom.btnToggleTheme.addEventListener('click', toggleTheme);
    dom.btnToggleFavorites.addEventListener('click', () => toggleFavoritesFilter());

    let debounceTimer;
    dom.mainSearchInput?.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.searchQuery = e.target.value;
        if (state.searchQuery) {
          dom.btnClearSearch?.classList.remove('hidden');
        } else {
          dom.btnClearSearch?.classList.add('hidden');
        }
        applyFiltersAndSort();
      }, 150);
    });

    dom.btnClearSearch?.addEventListener('click', () => clearSearch());

    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== dom.mainSearchInput && document.activeElement !== dom.ingredientSearchInput) {
        e.preventDefault();
        dom.mainSearchInput?.focus();
      }
      if (e.key === 'Escape') {
        if (!dom.ingredientsModal.classList.contains('hidden')) {
          closeIngredientsModal();
        } else if (!dom.recipeModal.classList.contains('hidden')) {
          closeRecipeModal();
        }
      }
    });

    // CAMBIO DE IDIOMA (Español predeterminado)
    dom.filterLanguage.addEventListener('change', async (e) => {
      const newLang = e.target.value;
      if (newLang !== state.currentLanguage) {
        state.currentLanguage = newLang;
        state.activeCategory = 'all';
        state.selectedIngredients.clear();
        await loadRecipesData(newLang);
        showToast(`Catálogo cambiado a ${newLang === 'es' ? 'Español' : 'English'}`);
      }
    });

    // POPUP DE INGREDIENTES
    dom.btnOpenIngredientsModal.addEventListener('click', openIngredientsModal);
    dom.btnCloseIngredientsModal.addEventListener('click', closeIngredientsModal);

    dom.ingredientSearchInput?.addEventListener('input', (e) => {
      state.ingredientSearchQuery = e.target.value;
      if (state.ingredientSearchQuery) {
        dom.btnClearIngredientSearch?.classList.remove('hidden');
      } else {
        dom.btnClearIngredientSearch?.classList.add('hidden');
      }
      renderAvailableIngredientPills();
    });

    dom.btnClearIngredientSearch?.addEventListener('click', () => {
      state.ingredientSearchQuery = '';
      if (dom.ingredientSearchInput) dom.ingredientSearchInput.value = '';
      dom.btnClearIngredientSearch?.classList.add('hidden');
      renderAvailableIngredientPills();
      dom.ingredientSearchInput?.focus();
    });

    dom.btnClearAllIngredients.addEventListener('click', () => {
      state.selectedIngredients.clear();
      renderIngredientsModal();
    });

    dom.btnApplyIngredients.addEventListener('click', () => {
      closeIngredientsModal();
      applyFiltersAndSort();
    });

    dom.ingredientsModal.addEventListener('click', (e) => {
      if (e.target === dom.ingredientsModal) {
        closeIngredientsModal();
      }
    });

    // Filtros dropdown
    dom.filterDifficulty.addEventListener('change', (e) => {
      state.difficulty = e.target.value;
      applyFiltersAndSort();
    });

    dom.filterTime.addEventListener('change', (e) => {
      state.maxTime = e.target.value;
      applyFiltersAndSort();
    });

    dom.filterDevice.addEventListener('change', (e) => {
      state.device = e.target.value;
      applyFiltersAndSort();
    });

    dom.filterSort.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      applyFiltersAndSort();
    });

    dom.btnResetFilters.addEventListener('click', resetAllFilters);
    dom.btnEmptyReset.addEventListener('click', resetAllFilters);

    dom.btnRandomRecipe.addEventListener('click', pickRandomRecipe);

    dom.btnLoadMore.addEventListener('click', () => {
      state.displayedCount += state.batchSize;
      renderGrid();
    });

    window.addEventListener('scroll', () => {
      if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
        if (state.displayedCount < state.filteredRecipes.length) {
          state.displayedCount += state.batchSize;
          renderGrid();
        }
      }
    });

    dom.recipeModal.addEventListener('click', (e) => {
      if (e.target === dom.recipeModal) closeRecipeModal();
    });

    dom.btnTimerPlayPause.addEventListener('click', toggleTimerPlayPause);
    dom.btnTimerStop.addEventListener('click', stopTimer);

    window.addEventListener('hashchange', checkUrlHash);
  }

  function clearSearch() {
    if (dom.mainSearchInput) dom.mainSearchInput.value = '';
    dom.btnClearSearch?.classList.add('hidden');
    state.searchQuery = '';
    applyFiltersAndSort();
  }

  function resetAllFilters() {
    state.searchQuery = '';
    state.activeCategory = 'all';
    state.difficulty = 'all';
    state.maxTime = 'all';
    state.device = 'all';
    state.sortBy = 'rating';
    state.showOnlyFavorites = false;
    state.selectedIngredients.clear();

    clearSearch();
    dom.filterDifficulty.value = 'all';
    dom.filterTime.value = 'all';
    dom.filterDevice.value = 'all';
    dom.filterSort.value = 'rating';
    dom.btnToggleFavorites.classList.remove('bg-rose-100', 'text-rose-700', 'dark:bg-rose-950', 'dark:text-rose-300');

    renderCategories();
    applyFiltersAndSort();
  }

  function pickRandomRecipe() {
    if (state.allRecipes.length === 0) return;
    const randomIndex = Math.floor(Math.random() * state.allRecipes.length);
    const chosen = state.allRecipes[randomIndex];
    openRecipeModal(chosen.id);
  }

  function checkUrlHash() {
    const hash = window.location.hash;
    if (hash.startsWith('#recipe/')) {
      const id = parseInt(hash.replace('#recipe/', ''), 10);
      if (!isNaN(id) && (!state.currentRecipe || state.currentRecipe.id !== id)) {
        openRecipeModal(id);
      }
    }
  }

  async function shareCurrentRecipe() {
    const r = state.currentRecipe;
    if (!r) return;
    const url = window.location.href;
    const shareData = {
      title: `${r.title} - Monsieur Cuisine`,
      text: `Mira esta receta: ${r.title}`,
      url: url,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (e) {}
    } else {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Enlace copiado al portapapeles 📋', 'success');
      } catch (e) {
        showToast('No se pudo copiar el enlace', 'error');
      }
    }
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `px-4 py-2.5 rounded-xl text-xs font-semibold shadow-lg backdrop-blur-md flex items-center gap-2 transform transition-all duration-300 pointer-events-auto ${
      type === 'error'
        ? 'bg-rose-600 text-white'
        : type === 'success'
        ? 'bg-emerald-600 text-white'
        : 'bg-slate-900/90 text-white dark:bg-white/90 dark:text-slate-900'
    }`;
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
