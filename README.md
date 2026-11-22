# 🍳 Recetario Monsieur Cuisine Connect & Smart

> Plataforma web moderna para consultar más de 2.000 recetas oficiales de los robots de cocina **Monsieur Cuisine Connect (MC2.0)** y **Monsieur Cuisine Smart (MC3.0)**, con filtros inteligentes, ajuste dinámico de raciones, ajustes de máquina (velocidad, temperatura, tiempo) y temporizador integrado.

Desplegado de forma continua en **GitHub Pages** mediante **GitHub Actions** con extracción incremental y modo resiliente ante fallos.

---

## 🔍 Análisis Técnico: Cómo se extraen las recetas de MrCuisineVibeConnect

El proyecto [MrCuisineVibeConnect (Toque)](https://github.com/Wuki60/MrCuisineVibeConnect) implementa dos métodos de extracción de recetas dependiendo del entorno:

### 1. Extracción Directa vía API REST Pública (`McOnline.kt` / `OnlineSync.kt`)
Es el método principal para obtener recetas frescas por red sin necesidad de credenciales ni de la app oficial.

- **Servidor API:** `https://mc-api.tecpal.com` (Tecpal es el proveedor tecnológico de la plataforma Monsieur Cuisine).
- **Cabeceras HTTP críticas:**
  - `Accept: application/json`
  - `Accept-Language: <código>` (por ejemplo `es-ES`, `fr-FR`, `de-DE`, etc.).
  - `device-type: web`: **Esta cabecera es fundamental**, ya que indica al servidor que resuelva y envíe directamente los nombres legibles de los ingredientes y sus unidades en texto plano, en lugar de requerir una tabla de búsqueda por ID interno (`systemIngredientId`).
- **Endpoint de Listado con Paginación:**
  ```http
  GET /api/v2/recipes/page/{page}/size/{pageSize}?filters[deviceTypes][]={device}&filters[source][]=official
  ```
  - Parámetros:
    - `page`: Número de página (1-based).
    - `size`: Tamaño de página (100 por petición).
    - `filters[deviceTypes][]`: `MC2.0` (Connect) o `MC3.0` (Smart).
    - `filters[source][]`: `official` para recetas oficiales de Monsieur Cuisine.
- **Endpoint de Ficha Detallada:**
  ```http
  GET /api/v2/recipes/{recipeId}
  ```
  Proporciona la estructura completa:
  - `servingSizes`: Raciones (`amount`), unidad (`servingUnit`), grupos de ingredientes (`ingredientGroups`) y lista de ingredientes (`amount`, `unit`, `name`, `description`).
  - `steps`: Pasos de la receta con texto descriptivo y el objeto `deviceSetting`.
  - `deviceSetting`: Configuración del robot para cada paso:
    - Modos: `customized` (manual), `ramp` (aceleración progresiva), `turbo`, `steaming` (vapor), `roasting` (rehogar/sofreír), `kneading` (amasar), `scale` (báscula).
    - Parámetros: `time` (segundos), `speed` o `speedFloat` (velocidades 1 a 10), `temperature` (°C), `reverse` (giro a la izquierda / marcha atrás), `weight` (gramos en báscula).
  - `thumbnail` y `detailsImage`: URLs en CDN de las fotografías en formato horizontal (`landscape`) y cuadrado (`square`).
  - `nutrients`: Desglose nutricional (calorías, carbohidratos, grasas, proteínas).
- **Endpoint de Reseñas y Valoraciones:**
  ```http
  GET /api/v1/recipe-reviews/recipes/{apiId}/reviews?page={page}&size={size}
  ```
  Requiere la cabecera `X-Request-Id: <UUID>` y devuelve los comentarios y puntuaciones públicas de los usuarios.

---

### 2. Extracción Local desde la Base de Datos del Robot (`LidlSync.kt` / `OriginalDb.kt`)
En los robots Monsieur Cuisine Connect con acceso root, el firmware original de Lidl almacena los datos en una base de datos local SQLite:
- **Ruta local:** `/data/data/<pkg>/databases/Recipes`
- **Fotos descargadas:** `/data/data/<pkg>/files/recipe_images`
- **Esquema GreenDAO (Versión 9):**
  - Tabla `RECIPE`: IDs, nombres, idiomas, duraciones, raciones y niveles de dificultad.
  - Tabla `STEP`: Textos de cada paso y órdenes de ejecución.
  - Tabla `MACHINE_VALUES`: Valores de velocidad, temperatura, tiempo y sentido de giro por paso.
  - Tablas `INGREDIENT` e `INGREDIENTS_BASE`: Relación de alimentos, cantidades y medidas.
  - Tabla `TAG`: Etiquetas y categorizaciones.

---

## 🚀 Arquitectura del Proyecto

```
recetas/
├── .github/
│   └── workflows/
│       └── deploy.yml          # Flujo de GitHub Actions (extracción + despliegue Pages)
├── data/                       # 💾 Repositorio persistente de datos (versionado en Git)
│   ├── recipes.json            # Catálogo completo con ingredientes y pasos detallados
│   └── recipes_index.json      # Índice ligero optimizado para filtrado instantáneo
├── scripts/
│   └── extract_recipes.py      # Extractor asíncrono, incremental y tolerante a fallos
└── site/                       # 🌐 Aplicación Web (desplegada en GitHub Pages)
    ├── index.html              # Estructura semántica moderna con Tailwind y Lucide Icons
    ├── app.js                  # Motor reactivo: filtros, escalador de raciones y temporizador
    ├── styles.css              # Estilos personalizados, modo oscuro y estilos de impresión
    ├── favicon.svg             # Favicon vectorial temático
    └── data/                   # Copia de los datos consumidos por la web
```

---

## 🛡️ Resiliencia y Actualización Incremental

Por diseño, el sistema cumple los siguientes principios de estabilidad:

1. **Persistencia en el Repositorio (`data/`):**
   Las recetas extraídas se guardan y confirman en la carpeta `data/` del propio repositorio.
2. **Actualización Incremental:**
   En cada ejecución, el script compara el campo `lastUpdated` del listado de la API con las recetas ya almacenadas. Solo descarga las recetas nuevas o modificadas, completando la verificación en apenas unos segundos y sin saturar los servidores de Monsieur Cuisine.
3. **Modo Resiliente ante Caídas de la API:**
   Si la API oficial de Tecpal o la conexión sufren una interrupción o devuelven errores HTTP/DNS, el script activa automáticamente el **Modo Resiliente**: reutiliza las recetas guardadas en `data/` y finaliza con código de éxito (`exit 0`). De este modo, **el despliegue en GitHub Pages nunca se rompe**.

---

## 💻 Funcionalidades de la Aplicación Web

- ⚡ **Carga Ultrarrápida:** Carga primero `recipes_index.json` (~900 KB, ~120 KB comprimido en red) para una interactividad inmediata.
- 🔍 **Búsqueda en Vivo:** Búsqueda instantánea por título de receta, ingredientes y etiquetas con atajo de teclado (`/`).
- 🏷️ **Filtros Combinables:**
  - Categorías con conteos dinámicos en tiempo real.
  - Dificultad (🟢 Fácil, 🟡 Media, 🔴 Difícil).
  - Tiempo máximo (&le; 30 min, &le; 60 min, &le; 90 min).
  - Dispositivo (Monsieur Cuisine Connect `MC2.0` / Monsieur Cuisine Smart `MC3.0`).
  - Tipo de dieta (Vegetariano, Vegano).
  - Ordenación por valoración (estrellas), popularidad, menor tiempo o alfabético.
- ⚖️ **Escalador Inteligente de Raciones:** Modifica el número de raciones (`-` / `+`) y las cantidades de los ingredientes se recalculan proporcionalmente en tiempo real.
- ✅ **Lista de la Compra / Checklist Interactivo:** Tacha los ingredientes conforme los añades al vaso del robot.
- 🤖 **Ajustes Exactos de la Máquina:** Cada paso resalta los parámetros específicos de Monsieur Cuisine:
  - ⏱️ Tiempo (segundos o minutos).
  - ⚡ Velocidad (1 a 10).
  - 🌡️ Temperatura (°C).
  - 🔄 Giro a la izquierda / Marcha atrás.
  - ⚖️ Báscula integrada con peso en gramos.
  - Modo especial: Amasar, Vapor, Rehogar/Sofreír, Turbo.
- ⏱️ **Temporizador de Cocina Integrado:** Al pulsar sobre el tiempo de cualquier paso se inicia un temporizador flotante en pantalla con aviso sonoro al concluir.
- ❤️ **Mis Favoritas:** Guarda recetas en el navegador (`localStorage`) para acceso rápido.
- 🎲 **"Sorpréndeme":** Selector de receta aleatoria cuando no sabes qué cocinar.
- 🌓 **Modo Oscuro / Claro:** Detección automática del sistema operativo y selector manual guardado.
- 🖨️ **Modo Impresión Limpio:** Hoja de estilos adaptada (`@media print`) para imprimir la receta o guardarla en PDF sin cabeceras ni botones sobrantes.
- 🔗 **Enlaces Directos (Deep Linking):** Cada receta cuenta con su URL `#recipe/<id>` para compartirla directamente.

---

## 🛠️ Ejecución Local

Si deseas probar el extractor o el sitio web en tu equipo:

1. **Instalar requisitos:**
   ```bash
   pip install aiohttp
   ```

2. **Ejecutar el extractor:**
   ```bash
   # Extraer todas las recetas oficiales en español de forma incremental
   python scripts/extract_recipes.py

   # Opciones adicionales:
   python scripts/extract_recipes.py --lang fr-FR        # Cambiar idioma (ej: francés)
   python scripts/extract_recipes.py --device MC2.0      # Solo Monsieur Cuisine Connect
   python scripts/extract_recipes.py --force             # Forzar re-descarga completa
   python scripts/extract_recipes.py --limit 20          # Extraer solo 20 recetas para pruebas
   ```

3. **Abrir el sitio web:**
   Puedes iniciar un servidor web estático en la carpeta `site/`:
   ```bash
   cd site
   python -m http.server 8000
   ```
   Abre [http://localhost:8000](http://localhost:8000) en tu navegador.

---

## ⚙️ Configuración en GitHub Actions y GitHub Pages

1. **Activar GitHub Pages:**
   - En tu repositorio de GitHub, ve a **Settings** > **Pages**.
   - En **Build and deployment** > **Source**, selecciona **GitHub Actions**.
2. **Despliegues Automáticos:**
   - El workflow `.github/workflows/deploy.yml` se ejecutará automáticamente en cada `git push` a la rama `main` y semanalmente mediante cron.
   - También puedes lanzarlo manualmente desde la pestaña **Actions** seleccionando el flujo y pulsando en **Run workflow**.

---

## 📄 Licencia

Este proyecto se distribuye bajo la licencia MIT. Los datos y recetas pertenecen a sus respectivos autores y a Lidl / Monsieur Cuisine (Tecpal).
