/**
 * PREDIGOLES — Backend multi-cliente (Apps Script)
 * ---------------------------------------------------
 * Cada "cliente vendido" vive en su propia pestaña (kv1, kv2, kv3...) dentro
 * de ESTA MISMA hoja de cálculo. El frontend manda qué pestaña usar en cada
 * request (campo "tab"). Si la pestaña no existe todavía, se crea sola.
 */

/* ---------- CONFIGURACIÓN ---------- */
// Token de API-Football (api-football.com / api-sports.io). Configúralo en
// Editor de Apps Script → ⚙️ Configuración del proyecto → Propiedades de
// secuencia de comandos → nombre: APIFOOTBALL_KEY, valor: tu token real.
const APIFOOTBALL_KEY = PropertiesService.getScriptProperties().getProperty("APIFOOTBALL_KEY") || "";

/* ---------- ADMINISTRADOR CENTRAL (César) ---------- */
// El PIN maestro NUNCA vive en una hoja — solo en Propiedades del proyecto, así
// que jamás puede salir por getAll ni por ningún otro camino de lectura normal.
// Para configurarlo: abre la app publicada, consola del navegador (F12), corre
// _hashPin("tuPinMaestro") y pega el resultado aquí:
// ⚙️ Configuración del proyecto → Propiedades de secuencia de comandos →
// nombre: MASTER_PIN_HASH, valor: el hash que te dio la consola.
const MASTER_PIN_HASH = PropertiesService.getScriptProperties().getProperty("MASTER_PIN_HASH") || "";

const MASTER_SHEET_NAME = "_grupos_maestro";
const MASTER_HEADER = ["grupoId","nombreGrupo","nombreAdmin","celularAdmin","correoAdmin","torneoId","fechaCreacion","estadoPago"];

function _hashPinGS(pin) {
  // Debe ser IDÉNTICO al _hashPin() del frontend, para que los hashes coincidan.
  let h = 0;
  for (let i = 0; i < String(pin).length; i++) { h = ((h << 5) - h) + String(pin).charCodeAt(i); h |= 0; }
  return "ph_" + Math.abs(h).toString(36);
}
function checkMasterAuth(pinEnviado) {
  if (!MASTER_PIN_HASH) return { status: "error", message: "PIN maestro no configurado en el servidor todavía." };
  if (!pinEnviado || pinEnviado !== MASTER_PIN_HASH) return { status: "error", message: "PIN maestro inválido." };
  return null;
}
function getOrCreateMasterSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MASTER_SHEET_NAME);
    sheet.appendRow(MASTER_HEADER);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

const APIFOOTBALL_BASE = "https://v3.football.api-sports.io";

// Liga y temporada usadas HOY por la sincronización de resultados en vivo
// (_sincronizar). Si más adelante corres varios torneos en vivo a la vez,
// esto necesitaría generalizarse — por ahora sincroniza uno solo.
// ⚠️ Confirmar el ID de cada liga antes de usar (ver buscarLeagueIdColombia()
// más abajo, o el buscador equivalente para otras ligas).
const LEAGUE_ID = 239; // Liga BetPlay Colombia — confirmado
const SEASON = 2026;
const TORNEO_ACTIVO_SYNC = "fpc_2026_2"; // qué malla (ver _fixture_<id>) usa _sincronizar()

const TAB_NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const HEADER = ["key", "value"];

/* ---------- Malla de partidos por torneo (cargue vía API) ----------
   Cada torneo tiene su propia hoja "_fixture_<torneoId>" con una sola llave
   "partidos" que guarda el arreglo completo en JSON. El frontend la lee con
   la acción pública "getFixture" (no requiere PIN — el calendario no es
   información sensible). Para (re)cargar la malla completa de un torneo:

   1. Abre este proyecto en el editor de Apps Script.
   2. En la barra de funciones (arriba), selecciona "cargarFixtureDesdeAPI".
   3. Edita la línea de abajo con el torneoId/liga/temporada que quieras, y
      corre la función (▶). Revisa el log para confirmar cuántos partidos trajo.
   4. Repite cuando quieras refrescar (ej. cuando Dimayor confirme fechas
      nuevas) — sobrescribe la malla completa, pero NUNCA toca los ajustes
      manuales que cada grupo haya hecho con el botón 📅 (esos viven aparte,
      en la pestaña de cada grupo, no aquí).
*/
function getOrCreateFixtureTab(torneoId) {
  const nombreTab = "_fixture_" + torneoId;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(nombreTab);
  if (!sheet) {
    sheet = ss.insertSheet(nombreTab);
    sheet.appendRow(HEADER);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Google Sheets rechaza cualquier valor de celda de más de 50,000 caracteres.
// Con temporadas que traen cientos de partidos (o cuando "season" de la API
// agrupa varios torneos, ver roundContains abajo) el JSON de "partidos" puede
// acercarse a ese límite — mejor frenar con un mensaje claro que dejar que
// Sheets tire un error genérico a mitad de la escritura.
const LIMITE_CARACTERES_CELDA = 50000;

function cargarFixtureDesdeAPI(torneoId, leagueId, season, roundContains) {
  if (!APIFOOTBALL_KEY) { Logger.log("Falta configurar APIFOOTBALL_KEY en Propiedades del proyecto."); return; }
  if (!torneoId || !leagueId || !season) { Logger.log("Faltan parámetros: torneoId, leagueId y season son obligatorios."); return; }

  const url = APIFOOTBALL_BASE + "/fixtures?league=" + leagueId + "&season=" + season;
  const resp = UrlFetchApp.fetch(url, { headers: { "x-apisports-key": APIFOOTBALL_KEY }, muteHttpExceptions: true });
  const code = resp.getResponseCode();
  if (code !== 200) { Logger.log("Error API (HTTP " + code + ")"); return; }
  const parsed = JSON.parse(resp.getContentText());
  if (parsed.errors && Object.keys(parsed.errors).length) { Logger.log("Error API: " + JSON.stringify(parsed.errors)); return; }

  // api-football agrupa TODA la temporada bajo un solo "season" — en ligas con
  // Apertura y Clausura (como la colombiana) eso trae ambos torneos juntos.
  // roundContains filtra por el nombre de fase (ej. "Clausura") para quedarnos
  // solo con la malla que de verdad queremos guardar en este torneoId.
  let response = parsed.response || [];
  if (roundContains) {
    response = response.filter(function (m) {
      return String(m.league.round || "").indexOf(roundContains) !== -1;
    });
  }

  const partidos = response.map(function (m) {
    // status.short "TBD" = fecha/hora todavía no confirmada por la liga.
    const kick = m.fixture.status.short === "TBD" ? "" : m.fixture.date;
    const venue = (m.fixture.venue && m.fixture.venue.name)
      ? m.fixture.venue.name + (m.fixture.venue.city ? ", " + m.fixture.venue.city : "")
      : "Estadio por confirmar";
    return [
      "af_" + m.fixture.id,
      String(m.league.round || ""),
      kick,
      traducirEquipo(m.teams.home.name),
      traducirEquipo(m.teams.away.name),
      venue,
    ];
  });

  const json = JSON.stringify(partidos);
  if (json.length > LIMITE_CARACTERES_CELDA) {
    Logger.log("No se guardó: el JSON de \"" + torneoId + "\" tiene " + json.length + " caracteres, supera el límite de " + LIMITE_CARACTERES_CELDA + " por celda de Sheets. Usa roundContains para acotar a una sola fase (ver cargarFixtureDesdeAPI).");
    return;
  }

  const tab = getOrCreateFixtureTab(torneoId);
  setKey(tab, "partidos", json);
  Logger.log("Cargados " + partidos.length + " partidos para \"" + torneoId + "\" (liga " + leagueId + ", temporada " + season + (roundContains ? ", fase \"" + roundContains + "\"" : "") + ").");
}

/* api-football.com a veces usa nombres oficiales ligeramente distintos a los
   nuestros (ej. sin "F.C.", o con variantes de acento). Si la sincronización
   reporta partidos "sin mapear" que sí están jugándose, es casi seguro que el
   nombre que devuelve la API no coincide exacto — agrégalo aquí. */
const TEAM_DICT = {
  "America de Cali": "América de Cali",
  "Independiente Medellin": "Independiente Medellín",
  "Deportes Tolima": "Deportes Tolima",
  "Llaneros": "Llaneros F.C.",
  "Atletico Bucaramanga": "Atlético Bucaramanga",
  "Aguilas Doradas": "Águilas Doradas",
  "Deportivo Cali": "Deportivo Cali",
  "Millonarios": "Millonarios F.C.",
  "Once Caldas": "Once Caldas DAF",
  "Fortaleza CEIF": "Fortaleza",
  "Independiente Santa Fe": "Independiente Santa Fe",
  "Internacional": "Internacional de Bogotá",
  "Jaguares de Cordoba": "Jaguares F.C.",
  "Atletico Nacional": "Atlético Nacional",
  "Cucuta Deportivo": "Cúcuta Deportivo",
  "Deportivo Pereira": "Deportivo Pereira",
  "Alianza": "Alianza Valledupar F.C.",
  "Junior": "Junior F.C.",
  "Deportivo Pasto": "Deportivo Pasto",
  "Boyaca Chico": "Boyacá Chicó F.C.",
  // A partir del Clausura 2026-2 la API empezó a devolver nombres más cortos
  // para estos 7 equipos (confirmado contra la malla real ya cargada). Se
  // agregan sin borrar las variantes de arriba, por si la API vuelve a usar
  // el nombre largo en otra temporada.
  "Alianza Valledupar": "Alianza Valledupar F.C.",
  "Bucaramanga": "Atlético Bucaramanga",
  "Chico": "Boyacá Chicó F.C.",
  "Cucuta": "Cúcuta Deportivo",
  "Fortaleza FC": "Fortaleza",
  "Jaguares": "Jaguares F.C.",
  "Santa Fe": "Independiente Santa Fe",
};

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ status: "error", message: "JSON inválido" });
  }

  const action = body.action;

  // --- Acciones del Administrador Central: se resuelven ANTES de tocar
  // cualquier lógica de "tenant" (grupo), y nunca dependen de body.tab. ---
  if (action === "adminListarGrupos" || action === "adminProvisionarGrupo" || action === "adminActualizarPago" || action === "adminResetearPin") {
    return manejarAccionMaestra(action, body);
  }

  // Lectura pública de la malla de un torneo (no es información sensible,
  // no requiere PIN). Se resuelve aparte porque targetea deliberadamente una
  // pestaña "_fixture_<torneoId>", que el chequeo de nombre reservado de abajo
  // bloquearía si pasara por el camino normal de "tab".
  if (action === "getFixture") {
    const torneoId = sanitizeTab(String(body.torneoId || ""));
    if (!torneoId) return jsonOut({ status: "error", message: "torneoId inválido." });
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("_fixture_" + torneoId);
    if (!sheet) return jsonOut({ status: "success", partidos: [] });
    const raw = getValueFromSheet(sheet, "partidos");
    let partidos = [];
    try { partidos = raw ? JSON.parse(raw) : []; } catch (e) {}
    return jsonOut({ status: "success", partidos: partidos });
  }

  let tabRaw = body.tab || "kv1";
  const tab = sanitizeTab(String(tabRaw));
  if (!tab) return jsonOut({ status: "error", message: "tab inválido o vacío" });
  if (tab === MASTER_SHEET_NAME || tab.indexOf("_") === 0) {
    return jsonOut({ status: "error", message: "Nombre de grupo reservado." });
  }

  // Lectura pura y la pestaña ya existe: evitamos el lock global.
  if (action === "getAll") {
    const ssRapido = SpreadsheetApp.getActiveSpreadsheet();
    const hojaExistente = ssRapido.getSheetByName(tab);
    if (hojaExistente) return jsonOut(sanitizeGetAllOutput(getAllKV(hojaExistente)));
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateTab(tab);

    if (action === "set") {
      const key = String(body.key);
      // pin_<id> solo se toca por loginJugador (autoregistro) o
      // resetearPinJugador (requiere PIN de admin) — nunca por esta vía
      // genérica, o cualquiera podría fijar el PIN de otro jugador.
      if (key.indexOf("pin_") === 0) {
        return jsonOut({ status: "error", message: "Esta clave no se puede modificar por esta vía." });
      }
      if (isProtectedKey(key)) {
        const authError = checkAdminAuth(sheet, body.pin);
        if (authError) return jsonOut(authError);
      } else if (key.indexOf("preds_") === 0) {
        const playerId = key.slice("preds_".length);
        const authError = checkPlayerAuth(sheet, playerId, body.pin);
        if (authError) return jsonOut(authError);
      }
      setKey(sheet, key, body.value == null ? "" : String(body.value));
      return jsonOut({ status: "success" });
    }

    if (action === "getAll") {
      return jsonOut(sanitizeGetAllOutput(getAllKV(sheet)));
    }

    // --- Login de organizador: antes se verificaba en el navegador leyendo
    // el hash de adminPin vía getAll: cualquiera con el link podía leerlo y
    // atacarlo sin conexión. Ahora getAll nunca lo expone (ver
    // sanitizeGetAllOutput) y el PIN se verifica aquí, en el servidor. ---
    if (action === "loginOrganizador") {
      const authError = checkAdminAuth(sheet, body.pin);
      if (authError) return jsonOut(authError);
      return jsonOut({ status: "success" });
    }

    // --- Login de jugador: mismo cambio que loginOrganizador, pero también
    // cubre el autoregistro (primera vez que alguien usa ese playerId: se
    // guarda el PIN que envía y queda como dueño de esa identidad). ---
    if (action === "loginJugador") {
      const playerId = String(body.playerId || "");
      if (!playerId) return jsonOut({ status: "error", message: "playerId requerido." });
      const pinEnviado = String(body.pin || "");
      if (!pinEnviado) return jsonOut({ status: "error", message: "PIN requerido." });
      const storedHash = getValueFromSheet(sheet, "pin_" + playerId);
      if (!storedHash) {
        setKey(sheet, "pin_" + playerId, pinEnviado);
        return jsonOut({ status: "success", nuevo: true });
      }
      if (pinEnviado !== storedHash) return jsonOut({ status: "error", message: "PIN incorrecto." });
      return jsonOut({ status: "success", nuevo: false });
    }

    // --- Resetear el PIN de un jugador: función del organizador, así que
    // exige su PIN — antes cualquiera podía llamar esto sin autenticarse. ---
    if (action === "resetearPinJugador") {
      const authError = checkAdminAuth(sheet, body.pin);
      if (authError) return jsonOut(authError);
      const playerId = String(body.playerId || "");
      if (!playerId) return jsonOut({ status: "error", message: "playerId requerido." });
      setKey(sheet, "pin_" + playerId, "");
      return jsonOut({ status: "success" });
    }

    if (action === "joinRoster") {
      const player = body.player;
      if (!player || !player.id) return jsonOut({ status: "error", message: "player inválido" });

      let roster = [];
      const raw = getValueFromSheet(sheet, "roster");
      try { roster = raw ? JSON.parse(raw) : []; } catch (e) { roster = []; }

      const idx = roster.findIndex(function (p) { return p.id === player.id; });
      if (idx >= 0) {
        roster[idx] = player;
      } else {
        const nombreTomado = roster.some(function (p) {
          return p.id !== player.id && String(p.name).trim().toLowerCase() === String(player.name).trim().toLowerCase();
        });
        if (nombreTomado) {
          return jsonOut({ status: "name_taken", roster: roster });
        }
        roster.push(player);
      }
      setKey(sheet, "roster", JSON.stringify(roster));
      return jsonOut({ status: "success", roster: roster });
    }

    if (action === "syncNow") {
      const resultado = _sincronizar();
      return jsonOut({ status: "success", sincronizados: resultado.sincronizados, enVivo: resultado.enVivo, limpiados: resultado.limpiados, total: resultado.total, sinMapear: resultado.sinMapear, error: resultado.error || null });
    }

    return jsonOut({ status: "error", message: "acción desconocida: " + action });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Acciones del Administrador Central ---------- */
function manejarAccionMaestra(action, body) {
  const authErr = checkMasterAuth(body.masterPin);
  if (authErr) return jsonOut(authErr);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (action === "adminListarGrupos") {
      const sheet = getOrCreateMasterSheet();
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return jsonOut({ status: "success", grupos: [] });
      const data = sheet.getRange(2, 1, lastRow - 1, MASTER_HEADER.length).getValues();
      const grupos = data.map(function (row) {
        const obj = {};
        MASTER_HEADER.forEach(function (col, i) { obj[col] = row[i]; });
        return obj;
      });
      return jsonOut({ status: "success", grupos: grupos });
    }

    if (action === "adminProvisionarGrupo") {
      const grupoId = sanitizeTab(String(body.grupoId || ""));
      if (!grupoId) return jsonOut({ status: "error", message: "ID de grupo inválido (solo letras, números y guiones)." });
      if (grupoId === MASTER_SHEET_NAME || grupoId.indexOf("_") === 0) {
        return jsonOut({ status: "error", message: "Ese nombre está reservado, elige otro." });
      }
      const nombreGrupo = String(body.nombreGrupo || "").trim();
      if (!nombreGrupo) return jsonOut({ status: "error", message: "Falta el nombre del grupo." });
      const torneoId = String(body.torneoId || "").trim();
      if (!torneoId) return jsonOut({ status: "error", message: "Falta el torneo." });

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName(grupoId);
      if (sheet) {
        const yaConfigurado = getValueFromSheet(sheet, "adminPin");
        if (yaConfigurado) {
          return jsonOut({ status: "error", message: "Ese grupo ya existe y ya está configurado — no se puede volver a provisionar (evita borrar datos activos)." });
        }
      } else {
        sheet = ss.insertSheet(grupoId);
        sheet.appendRow(HEADER);
        sheet.setFrozenRows(1);
      }

      let pin = String(body.pin || "").trim();
      if (!pin) pin = String(Math.floor(1000 + Math.random() * 9000)); // genera uno de 4 dígitos si no se especificó
      if (!/^\d{4}$/.test(pin)) return jsonOut({ status: "error", message: "El PIN debe ser de 4 dígitos." });

      // El frontend lee estas claves con getJSON() (hace JSON.parse), así que
      // deben guardarse codificadas en JSON — no como texto plano — o el
      // parse falla en silencio y el grupo aparece como "no encontrado".
      setKey(sheet, "groupName", JSON.stringify(nombreGrupo));
      setKey(sheet, "adminPin", _hashPinGS(pin));
      setKey(sheet, "torneoId", JSON.stringify(torneoId));
      const modoSeguimiento = (body.modoSeguimiento === "equipo") ? "equipo" : "torneo";
      setKey(sheet, "modoSeguimiento", JSON.stringify(modoSeguimiento));
      setKey(sheet, "equiposSeguidos", JSON.stringify(Array.isArray(body.equiposSeguidos) ? body.equiposSeguidos : []));

      const masterSheet = getOrCreateMasterSheet();
      masterSheet.appendRow([
        grupoId, nombreGrupo,
        String(body.nombreAdmin || ""), String(body.celularAdmin || ""), String(body.correoAdmin || ""),
        torneoId, new Date().toISOString(), String(body.estadoPago || "Pendiente")
      ]);

      return jsonOut({ status: "success", grupoId: grupoId, pin: pin });
    }

    if (action === "adminActualizarPago") {
      const grupoId = String(body.grupoId || "");
      const estadoPago = String(body.estadoPago || "");
      if (!grupoId || !estadoPago) return jsonOut({ status: "error", message: "Faltan datos." });
      const masterSheet = getOrCreateMasterSheet();
      const lastRow = masterSheet.getLastRow();
      if (lastRow < 2) return jsonOut({ status: "error", message: "No hay grupos registrados." });
      const ids = masterSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (ids[i][0] === grupoId) {
          masterSheet.getRange(i + 2, MASTER_HEADER.indexOf("estadoPago") + 1).setValue(estadoPago);
          return jsonOut({ status: "success" });
        }
      }
      return jsonOut({ status: "error", message: "Grupo no encontrado en el registro maestro." });
    }

    if (action === "adminResetearPin") {
      const grupoId = sanitizeTab(String(body.grupoId || ""));
      if (!grupoId) return jsonOut({ status: "error", message: "ID de grupo inválido." });
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(grupoId);
      if (!sheet) return jsonOut({ status: "error", message: "Ese grupo no existe." });
      let pin = String(body.pin || "").trim();
      if (!pin) pin = String(Math.floor(1000 + Math.random() * 9000));
      if (!/^\d{4}$/.test(pin)) return jsonOut({ status: "error", message: "El PIN debe ser de 4 dígitos." });
      setKey(sheet, "adminPin", _hashPinGS(pin));
      return jsonOut({ status: "success", grupoId: grupoId, pin: pin });
    }

    return jsonOut({ status: "error", message: "Acción maestra desconocida." });
  } catch (err) {
    return jsonOut({ status: "error", message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const log = cronSincronizarResultados();
  return ContentService.createTextOutput(log).setMimeType(ContentService.MimeType.TEXT);
}

/* ---------- SEGURIDAD ---------- */

const PROTECTED_KEYS = ["results", "betting", "groupName", "adminPin", "teamOverrides", "modoSeguimiento", "equiposSeguidos"];
function isProtectedKey(key) {
  return PROTECTED_KEYS.indexOf(key) !== -1;
}

function checkAdminAuth(sheet, pinEnviado) {
  const adminPinGuardado = getValueFromSheet(sheet, "adminPin");
  // Ya NO existe "primer set libre": todo grupo nace provisionado por el
  // administrador central (acción adminProvisionarGrupo), nunca por
  // autoconfiguración espontánea de quien abra el link primero.
  if (!adminPinGuardado || !pinEnviado || pinEnviado !== adminPinGuardado) {
    return { status: "error", message: "PIN de administrador inválido, ausente, o el grupo aún no ha sido creado por el administrador central." };
  }
  return null;
}

// Igual que checkAdminAuth pero por jugador — protege preds_<id> para que
// nadie más pueda sobrescribir el pronóstico de otra persona sin su PIN.
function checkPlayerAuth(sheet, playerId, pinEnviado) {
  const storedHash = getValueFromSheet(sheet, "pin_" + playerId);
  if (!storedHash || !pinEnviado || pinEnviado !== storedHash) {
    return { status: "error", message: "PIN de jugador inválido o el jugador no ha iniciado sesión en este dispositivo." };
  }
  return null;
}

/* "Pagos" fue retirado como funcionalidad (el producto es peer-to-peer: cada
   jugador le transfiere directo al ganador, no hay nada que el admin recaude).
   Este filtro se deja como limpieza defensiva por si algún grupo viejo todavía
   tiene datos de "pagos" guardados de antes — nunca deben salir en getAll.
   adminPin y pin_<id> tampoco deben salir nunca: antes el navegador los leía
   de aquí para comparar el PIN localmente, lo que permitía a cualquiera con
   el link intentar romperlos sin conexión — ahora esa verificación vive en
   el servidor (ver loginOrganizador/loginJugador) y el hash nunca viaja. */
function sanitizeGetAllOutput(data) {
  if (!data) return data;
  if ("pagos" in data) delete data.pagos;
  delete data.adminPin;
  Object.keys(data).forEach(function (k) {
    if (k.indexOf("pin_") === 0) delete data[k];
  });
  return data;
}

function normalizar(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function traducirEquipo(nombreAPI) {
  if (TEAM_DICT[nombreAPI]) return TEAM_DICT[nombreAPI];
  return nombreAPI;
}

/**
 * LIMPIEZA ÚNICA: fusiona jugadores duplicados (mismo nombre, IDs distintos).
 */
function mergeDuplicatePlayers() {
  const tenantSheets = getAllTenantSheets();
  const reporte = [];

  tenantSheets.forEach(function (sheet) {
    const rosterRaw = getValueFromSheet(sheet, "roster");
    let roster = [];
    try { roster = rosterRaw ? JSON.parse(rosterRaw) : []; } catch (e) { return; }
    if (!roster.length) return;

    const grupos = {};
    roster.forEach(function (p) {
      const key = normalizar(p.name);
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(p);
    });

    let cambiosEnSheet = false;
    const nuevoRoster = [];

    Object.keys(grupos).forEach(function (key) {
      const grupo = grupos[key];
      if (grupo.length === 1) { nuevoRoster.push(grupo[0]); return; }

      let mejor = grupo[0], mejorCount = -1;
      grupo.forEach(function (p) {
        const predsRaw = getValueFromSheet(sheet, "preds_" + p.id);
        let count = 0;
        try { count = predsRaw ? Object.keys(JSON.parse(predsRaw)).length : 0; } catch (e) {}
        if (count > mejorCount) { mejorCount = count; mejor = p; }
      });

      const predsGanadorRaw = getValueFromSheet(sheet, "preds_" + mejor.id);
      let predsGanador = {};
      try { predsGanador = predsGanadorRaw ? JSON.parse(predsGanadorRaw) : {}; } catch (e) {}

      grupo.forEach(function (p) {
        if (p.id === mejor.id) return;
        const predsPerdedorRaw = getValueFromSheet(sheet, "preds_" + p.id);
        let predsPerdedor = {};
        try { predsPerdedor = predsPerdedorRaw ? JSON.parse(predsPerdedorRaw) : {}; } catch (e) {}
        Object.keys(predsPerdedor).forEach(function (mid) {
          if (!(mid in predsGanador)) predsGanador[mid] = predsPerdedor[mid];
        });
      });
      setKey(sheet, "preds_" + mejor.id, JSON.stringify(predsGanador));
      nuevoRoster.push(mejor);
      cambiosEnSheet = true;
      reporte.push(sheet.getName() + ": fusionó " + grupo.length + " registros de \"" + mejor.name + "\" en " + mejor.id);
    });

    if (cambiosEnSheet) setKey(sheet, "roster", JSON.stringify(nuevoRoster));
  });

  const out = reporte.length ? reporte.join("\n") : "No se encontraron duplicados.";
  Logger.log(out);
  return out;
}

/**
 * LIMPIEZA ÚNICA: quita campos legado de "betting" (adminPct, pagos) que ya
 * no existen en el modelo actual — el producto es peer-to-peer, no recauda
 * ni cobra comisión; "betting" hoy solo debe guardar inscripcion/premios
 * como referencia informativa para el organizador. Corre esto una vez para
 * no dejar en la hoja ningún rastro de un modelo de recaudo descartado por
 * decisión de negocio (evitar cualquier apariencia de administrar apuestas
 * ante entidades como Coljuegos).
 */
function limpiarBettingLegacy() {
  const tenantSheets = getAllTenantSheets();
  const reporte = [];

  tenantSheets.forEach(function (sheet) {
    const raw = getValueFromSheet(sheet, "betting");
    if (!raw) return;
    let betting;
    try { betting = JSON.parse(raw); } catch (e) { return; }
    if (!betting || typeof betting !== "object") return;

    const camposViejos = ["adminPct", "pagos"].filter(function (k) { return k in betting; });
    if (!camposViejos.length) return;

    const limpio = {
      inscripcion: betting.inscripcion || 0,
      premios: betting.premios || { p1: 0, p2: 0, p3: 0 },
    };
    setKey(sheet, "betting", JSON.stringify(limpio));
    reporte.push(sheet.getName() + ": se quitó " + camposViejos.join(" y "));
  });

  const out = reporte.length ? reporte.join("\n") : "No se encontraron campos legado (adminPct/pagos) en ningún grupo.";
  Logger.log(out);
  return out;
}

/**
 * LIMPIEZA ÚNICA: borra pestañas "placeholder" vacías que getOrCreateTab crea
 * automáticamente cuando alguien visita ?grupo=X con un identificador que
 * nunca fue provisionado (ej. una variante de mayúsculas/minúsculas de un
 * grupo real, como "prueba_01" vs. el "Prueba_01" real — los nombres de
 * pestaña en Sheets distinguen mayúsculas). Solo borra pestañas que tengan
 * como máximo la fila de encabezado (sin datos) y sin "groupName" — nunca
 * toca una pestaña con cualquier dato real, por accidental que parezca.
 */
function limpiarPestanasVacias() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reporte = [];

  ss.getSheets().forEach(function (sheet) {
    const nombre = sheet.getName();
    if (!TAB_NAME_RE.test(nombre)) return;
    if (nombre === MASTER_SHEET_NAME || nombre.indexOf("_fixture_") === 0) return;
    if (sheet.getLastRow() > 1) return; // tiene datos más allá del encabezado: no tocar
    if (getValueFromSheet(sheet, "groupName")) return; // grupo real, aunque esté casi vacío: no tocar

    ss.deleteSheet(sheet);
    reporte.push(nombre + ": pestaña vacía eliminada");
  });

  const out = reporte.length ? reporte.join("\n") : "No se encontraron pestañas vacías para eliminar.";
  Logger.log(out);
  return out;
}

/**
 * REPARACIÓN ÚNICA: adminProvisionarGrupo guardaba groupName/torneoId/
 * modoSeguimiento como texto plano, pero el frontend siempre los lee con
 * getJSON() (que hace JSON.parse) — el parse fallaba en silencio y el grupo
 * aparecía como "no encontrado" aunque los datos estuvieran ahí (así se
 * detectó: el grupo "Prueba_01" quedó así desde que se creó por el panel
 * central el 2026-09-12). Ya se corrigió el origen en adminProvisionarGrupo;
 * esto repara los grupos que ya quedaron mal guardados. Es seguro correrlo
 * más de una vez: si un valor ya es JSON válido, lo deja tal cual.
 */
function repararCodificacionJSON() {
  const claves = ["groupName", "torneoId", "modoSeguimiento"];
  const tenantSheets = getAllTenantSheets();
  const reporte = [];

  tenantSheets.forEach(function (sheet) {
    claves.forEach(function (clave) {
      const raw = getValueFromSheet(sheet, clave);
      if (!raw) return;
      try {
        JSON.parse(raw);
        return; // ya es JSON válido, no tocar
      } catch (e) {
        setKey(sheet, clave, JSON.stringify(raw));
        reporte.push(sheet.getName() + "." + clave + ": recodificado a JSON");
      }
    });
  });

  const out = reporte.length ? reporte.join("\n") : "No se encontraron valores mal codificados.";
  Logger.log(out);
  return out;
}

/**
 * Sincroniza resultados y marcadores en vivo desde api-football.com.
 * Trae TODA la temporada de la liga en una sola llamada (barato en cuota:
 * 1 request, sin importar cuántos partidos devuelva) y filtra localmente.
 */
function _sincronizar() {
  const fixtureTab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("_fixture_" + TORNEO_ACTIVO_SYNC);
  const fixtureRaw = fixtureTab ? getValueFromSheet(fixtureTab, "partidos") : null;
  let fixtureList = [];
  try { fixtureList = fixtureRaw ? JSON.parse(fixtureRaw) : []; } catch (e) {}
  // Convierte del formato de fila [id, fase, kick, home, away, venue] al {id, home, away}
  // que el resto de esta función ya sabía usar (así no hubo que reescribir toda la lógica).
  const FIXTURE_ACTUAL = fixtureList.map(function (r) { return { id: r[0], home: r[3], away: r[4] }; });

  if (!APIFOOTBALL_KEY) {
    return { error: "Falta configurar APIFOOTBALL_KEY en Propiedades del proyecto.", sincronizados: 0, total: FIXTURE_ACTUAL.length, sinMapear: [], clientes: [] };
  }
  if (!LEAGUE_ID) {
    return { error: "Falta confirmar LEAGUE_ID.", sincronizados: 0, total: FIXTURE_ACTUAL.length, sinMapear: [], clientes: [] };
  }
  if (!FIXTURE_ACTUAL.length) {
    return { error: "La malla de \"" + TORNEO_ACTIVO_SYNC + "\" está vacía — corre cargarFixtureDesdeAPI() primero.", sincronizados: 0, total: 0, sinMapear: [], clientes: [] };
  }

  let apiMatches;
  try {
    const url = APIFOOTBALL_BASE + "/fixtures?league=" + LEAGUE_ID + "&season=" + SEASON;
    const resp = UrlFetchApp.fetch(url, { headers: { "x-apisports-key": APIFOOTBALL_KEY }, muteHttpExceptions: true });
    const code = resp.getResponseCode();
    if (code !== 200) {
      return { error: "Error API (HTTP " + code + ")", sincronizados: 0, total: FIXTURE_ACTUAL.length, sinMapear: [], clientes: [] };
    }
    const parsed = JSON.parse(resp.getContentText());
    if (parsed.errors && Object.keys(parsed.errors).length) {
      return { error: "API respondió con error: " + JSON.stringify(parsed.errors), sincronizados: 0, total: FIXTURE_ACTUAL.length, sinMapear: [], clientes: [] };
    }
    apiMatches = parsed.response || [];
  } catch (err) {
    return { error: "Error consultando la API: " + err, sincronizados: 0, total: FIXTURE_ACTUAL.length, sinMapear: [], clientes: [] };
  }

  // Estados de api-football.com: NS (no iniciado), 1H/HT/2H/ET/BT/P (en juego),
  // FT/AET/PEN (terminado). https://www.api-football.com/documentation-v3
  const ESTADOS_TERMINADO = ["FT", "AET", "PEN"];
  const ESTADOS_EN_JUEGO = ["1H", "HT", "2H", "ET", "BT", "P"];

  function indexarPorNombres(lista) {
    const idx = {};
    lista.forEach(function (m) {
      const h = normalizar(traducirEquipo(m.teams.home.name));
      const a = normalizar(traducirEquipo(m.teams.away.name));
      idx[h + "|" + a] = m;
    });
    return idx;
  }
  function buscarPartido(indice, m) {
    const h = normalizar(m.home), a = normalizar(m.away);
    let p = indice[h + "|" + a];
    if (p) return { p: p, swap: false };
    p = indice[a + "|" + h];
    if (p) return { p: p, swap: true };
    return null;
  }
  function esPlaceholder(m) {
    return m.home.indexOf("Por definir") === 0 || m.home.indexOf("Ganador") === 0 || m.home.indexOf("Perdedor") === 0 ||
           m.away.indexOf("Por definir") === 0 || m.away.indexOf("Ganador") === 0 || m.away.indexOf("Perdedor") === 0;
  }
  // "af_1549780" -> 1549780 (el id real que usa api-football, embebido en el
  // id interno desde cargarFixtureDesdeAPI). null si el fixture no tiene ese
  // formato, en cuyo caso cae al respaldo por nombre más abajo.
  function idAPIFootball(fixtureId) {
    const m = /^af_(\d+)$/.exec(String(fixtureId));
    return m ? Number(m[1]) : null;
  }

  const finished = apiMatches.filter(function (m) { return ESTADOS_TERMINADO.indexOf(m.fixture.status.short) !== -1; });
  const enJuego = apiMatches.filter(function (m) { return ESTADOS_EN_JUEGO.indexOf(m.fixture.status.short) !== -1; });
  // Índice principal: por id real de partido. Es inequívoco — a diferencia del
  // índice por nombre de equipo, nunca puede confundir el mismo enfrentamiento
  // repetido en otra fase de la temporada (p.ej. Apertura y Clausura, donde
  // cada pareja de equipos se juega dos veces). Ese fue justo el bug: el
  // índice por nombre solo guarda una entrada por pareja, así que el resultado
  // ya jugado de una fase se le pegaba al partido todavía no jugado de la otra.
  const idxIdFinished = {};
  finished.forEach(function (m) { idxIdFinished[m.fixture.id] = m; });
  const idxIdEnJuego = {};
  enJuego.forEach(function (m) { idxIdEnJuego[m.fixture.id] = m; });
  // Todos los partidos que la API sí conoce (jugados, en vivo o no iniciados) —
  // sirve para distinguir "confirmado que aún no se juega" (limpiar cualquier
  // marcador viejo) de "no aparece en la respuesta de la API" (no tocar nada,
  // podría ser un problema pasajero de la API y no queremos borrar por error).
  const idxIdTodos = {};
  apiMatches.forEach(function (m) { idxIdTodos[m.fixture.id] = m; });
  // Respaldo por nombre: solo para fixtures sin id real (no debería pasar con
  // la malla actual, que siempre viene de cargarFixtureDesdeAPI, pero queda
  // por si algún día se carga una malla de otra forma).
  const idxFinished = indexarPorNombres(finished);
  const idxEnJuego = indexarPorNombres(enJuego);

  const syncedResults = {};
  const syncedLive = {};
  const sinMapear = [];
  // Fixtures que la API confirma que AÚN NO SE JUEGAN (o se posrgaron): si ya
  // tenían un marcador guardado de antes —como los que dejó el bug de
  // emparejar por nombre—, hay que borrarlo, no solo dejar de escribir uno nuevo.
  const aLimpiar = [];
  const ahoraISO = new Date().toISOString();

  FIXTURE_ACTUAL.forEach(function (m) {
    if (esPlaceholder(m)) return;

    const apiId = idAPIFootball(m.id);
    if (apiId != null) {
      const pFin = idxIdFinished[apiId];
      if (pFin) {
        // goals.home/away ya excluye penales de definición (esos van aparte en score.penalty).
        const h = pFin.goals.home == null ? 0 : pFin.goals.home, a = pFin.goals.away == null ? 0 : pFin.goals.away;
        syncedResults[m.id] = { h: String(h), a: String(a) };
        return;
      }
      const pLive = idxIdEnJuego[apiId];
      if (pLive) {
        const h = pLive.goals.home == null ? 0 : pLive.goals.home, a = pLive.goals.away == null ? 0 : pLive.goals.away;
        syncedLive[m.id] = {
          h: String(h), a: String(a),
          minute: pLive.fixture.status.elapsed != null ? pLive.fixture.status.elapsed : null,
          status: pLive.fixture.status.short,
          syncedAt: ahoraISO,
        };
        return;
      }
      if (idxIdTodos[apiId]) {
        // La API sí tiene este partido y su estado no es "terminado" ni "en
        // juego" (NS, TBD, pospuesto, etc.) — confirmado que no hay marcador
        // real todavía. Si quedó uno guardado de antes, se limpia abajo.
        aLimpiar.push(m.id);
        return;
      }
      // apiId válido pero la API no devolvió nada para él — no tocar lo que
      // haya guardado, podría ser un hueco temporal de la API, no evidencia
      // de que el partido no se jugó.
      return;
    }

    const finMatch = buscarPartido(idxFinished, m);
    if (finMatch) {
      const p = finMatch.p, swap = finMatch.swap;
      const h = p.goals.home == null ? 0 : p.goals.home, a = p.goals.away == null ? 0 : p.goals.away;
      syncedResults[m.id] = swap ? { h: String(a), a: String(h) } : { h: String(h), a: String(a) };
      return;
    }

    const liveMatch = buscarPartido(idxEnJuego, m);
    if (liveMatch) {
      const p = liveMatch.p, swap = liveMatch.swap;
      const h = p.goals.home == null ? 0 : p.goals.home, a = p.goals.away == null ? 0 : p.goals.away;
      syncedLive[m.id] = {
        h: String(swap ? a : h), a: String(swap ? h : a),
        minute: p.fixture.status.elapsed != null ? p.fixture.status.elapsed : null,
        status: p.fixture.status.short,
        syncedAt: ahoraISO,
      };
      return;
    }

    sinMapear.push(m.home + " vs " + m.away + " (id " + m.id + ")");
  });

  const tenantSheets = getAllTenantSheets();
  let limpiados = 0;
  tenantSheets.forEach(function (sheet) {
    const currentResultsRaw = getValueFromSheet(sheet, "results");
    let currentResults = {};
    try { currentResults = currentResultsRaw ? JSON.parse(currentResultsRaw) : {}; } catch (e) {}
    Object.keys(syncedResults).forEach(function (id) { currentResults[id] = syncedResults[id]; });
    aLimpiar.forEach(function (id) {
      if (Object.prototype.hasOwnProperty.call(currentResults, id)) { delete currentResults[id]; limpiados++; }
    });
    setKey(sheet, "results", JSON.stringify(currentResults));
    setKey(sheet, "live", JSON.stringify(syncedLive));
  });

  return {
    sincronizados: Object.keys(syncedResults).length,
    enVivo: Object.keys(syncedLive).length,
    limpiados: limpiados,
    total: FIXTURE_ACTUAL.length,
    sinMapear: sinMapear,
    clientes: tenantSheets.map(function (s) { return s.getName(); }),
  };
}

function cronSincronizarResultados() {
  const r = _sincronizar();
  if (r.error) { Logger.log(r.error); return r.error; }
  const lines = [];
  lines.push("Partidos sincronizados: " + r.sincronizados + "/" + r.total);
  lines.push("En vivo ahora: " + (r.enVivo || 0));
  if (r.limpiados) lines.push("Marcadores viejos limpiados (partidos que resultaron no jugados): " + r.limpiados);
  if (r.sinMapear.length) lines.push("Pendientes o sin mapear: " + r.sinMapear.join(" | "));
  lines.push("Actualizado en " + r.clientes.length + " cliente(s): " + r.clientes.join(", "));
  const out = lines.join("\n");
  Logger.log(out);
  return out;
}

function runManualSyncTest() {
  Logger.log(cronSincronizarResultados());
}

/**
 * Ayuda de una sola vez: llama esto (▶ run buscarLeagueIdColombia) para que el
 * log te diga el ID exacto de la Liga BetPlay en api-football.com — pégalo en
 * LEAGUE_ID arriba y ya queda resuelto para siempre.
 */
function buscarLeagueIdColombia() {
  if (!APIFOOTBALL_KEY) { Logger.log("Falta configurar APIFOOTBALL_KEY primero."); return; }
  const url = APIFOOTBALL_BASE + "/leagues?search=Colombia";
  const resp = UrlFetchApp.fetch(url, { headers: { "x-apisports-key": APIFOOTBALL_KEY }, muteHttpExceptions: true });
  const parsed = JSON.parse(resp.getContentText());
  const lineas = (parsed.response || []).map(function (r) {
    return "id=" + r.league.id + " · " + r.league.name + " (" + r.country.name + ")";
  });
  Logger.log(lineas.join("\n") || "Sin resultados.");
}

function sanitizeTab(tab) {
  if (typeof tab !== "string") return null;
  return TAB_NAME_RE.test(tab) ? tab : null;
}

function getOrCreateTab(tabName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.appendRow(HEADER);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getAllTenantSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheets().filter(function (sheet) {
    if (!TAB_NAME_RE.test(sheet.getName())) return false;
    return !!getValueFromSheet(sheet, "groupName");
  });
}

function getValueFromSheet(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

function setKey(sheet, key, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    sheet.appendRow([key, value]);
    return;
  }
  const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (keys[i][0] === key) {
      sheet.getRange(i + 2, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function getAllKV(sheet) {
  const lastRow = sheet.getLastRow();
  const out = {};
  if (lastRow < 2) return out;
  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < data.length; i++) {
    const k = data[i][0];
    if (k === "" || k == null) continue;
    out[k] = data[i][1];
  }
  return out;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function correrCargaFixtureUnaVez() {
  // "Clausura": el season=2026 de esta liga trae Apertura y Clausura juntos —
  // sin este filtro se cae el límite de 50,000 caracteres por celda de Sheets.
  cargarFixtureDesdeAPI("fpc_2026_2", 239, 2026, "Clausura");
}

function cargarLaLiga() {
  cargarFixtureDesdeAPI("la_liga_2026_27", 140, 2026);
}
function cargarChampions() {
  cargarFixtureDesdeAPI("champions_2026_27", 2, 2026);
}
