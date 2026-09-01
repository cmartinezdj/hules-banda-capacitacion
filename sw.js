/* ============================================================================
   sw.js — LA MEMORIA DE LA APP EN EL APARATO  (Hules Banda · Sistema)

   POR QUÉ EXISTE ESTE ARCHIVO APARTE (única forma):
   El navegador EXIGE que un service worker viva en su propio archivo, con su
   propia dirección. No se puede meter dentro de index.html por diseño de
   seguridad: este código puede ver y contestar TODAS las peticiones del
   dominio, así que el navegador obliga a que sea auditable y con alcance
   limitado a su carpeta. Es la misma clase de excepción que ya tienen
   apple-touch-icon.png e icon-512.png (que iOS exige como archivos reales).

   QUÉ RESUELVE (Carlos, 31-jul-2026):
   Antes, CADA vez que alguien abría la app se bajaban 312 KB. En el rancho de
   un amigo de Carlos —y en las zonas de la planta donde el WiFi llega débil—
   eso se corta a medias y el navegador dice "No se puede conectar". Con esto la
   app se baja UNA vez y de ahí en adelante abre desde el propio teléfono.
   Internet solo se usa para lo que de verdad lo necesita (entrar, mensajes,
   documentos): unos cuantos KB, no 312.

   LA REGLA: "ABRE DE LA BODEGA, PERO REVISA POR DETRÁS"
   1) Contesta al instante con la copia guardada  -> por eso funciona sin señal.
   2) Al mismo tiempo le pregunta al servidor si hay versión nueva.
   3) Si la hay, la guarda y le avisa a la app, que se recarga sola.
   Así nadie se queda pegado en una versión vieja, que es la falla clásica de
   esto y sería grave para nosotros porque desplegamos casi a diario.

   LO QUE NUNCA SE GUARDA (a propósito):
   · NADA de otro origen: las llamadas a Supabase (entrar, PIN, mensajes,
     documentos, recibos de nómina) van SIEMPRE a la red. Aquí no se guarda ni
     un dato de nadie.
   · Los videos de capacitación (videos/*.mp4): uno solo pesa 22 MB y llenaría
     la bodega del teléfono.
   · Cualquier cosa que no sea GET (nada que escriba en el servidor).

   BOTÓN DE EMERGENCIA: si algo sale mal, se sube este mismo archivo con
   MODO_APAGADO = true. Cada aparato se desinstala solo al abrir y todo vuelve
   al comportamiento de antes, sin tocar a nadie.
   ============================================================================ */

var MODO_APAGADO = false;      // true = el service worker se desinstala solo
var VER   = 'v4';              // subir esto solo si cambia ESTE archivo
/* v4 (2-sep-2026): al subirlo, cada aparato tira su bodega vieja y se baja
   el index.html de HOY en la siguiente revisión. Se subió a propósito: había
   teléfonos con paquetes de varios despliegues atrás por el agujero de
   revisaIndex(), y así entran todos parejos sin que nadie haga nada. */
var CACHE = 'hb-app-' + VER;
var INDEX = './index.html';

/* Lo que se guarda de una vez al instalar. Ojo: solo el armazón de la app.
   Nada de datos, nada de videos. */
var ESTATICOS = [INDEX, './', './supabase.min.js',
                 './apple-touch-icon.png', './icon-512.png'];

self.addEventListener('install', function(e){
  if (MODO_APAGADO) return;
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      /* addAll falla entero si UN archivo falla; se guardan de uno en uno para
         que un icono ausente no tire la instalación completa. */
      return Promise.all(ESTATICOS.map(function(u){
        return c.add(new Request(u, {cache:'reload'})).catch(function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  if (MODO_APAGADO){
    e.waitUntil(self.registration.unregister().then(function(){
      return caches.keys().then(function(ks){
        return Promise.all(ks.map(function(k){ return caches.delete(k); }));
      });
    }).then(function(){ return self.clients.claim(); }));
    return;
  }
  e.waitUntil(
    caches.keys().then(function(ks){
      return Promise.all(ks.filter(function(k){ return k !== CACHE; })
                          .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
     .then(function(){ return revisaIndex(); })   /* al tomar el control, revisar de una */
  );
});

function avisaALaApp(tipo){
  return self.clients.matchAll({type:'window'}).then(function(cs){
    cs.forEach(function(c){ try{ c.postMessage({hb:tipo}); }catch(e){} });
  });
}

/* ⭐ 2-sep-2026 · EL AGUJERO QUE PIDIÓ CARLOS QUE SE ARREGLARA.
   La app pregunta cada 10 minutos si hay versión nueva, pero lo hacía con
   registration.update(), que revisa SOLO ESTE ARCHIVO (sw.js). Como sw.js casi
   nunca cambia, esa revisión siempre decía «nada nuevo» aunque index.html
   llevara diez despliegues encima. La única revisión real de index.html vivía
   en armazon(), que solo corre cuando se CARGA la página.
   Resultado: tras cada despliegue la primera apertura servía la versión vieja,
   y quien dejaba la app abierta todo el día no veía un arreglo nunca.
   Ahora la app puede pedir la revisión con un mensaje, y esto la hace de
   verdad: pregunta al servidor, compara el ETag y avisa si cambió. */
function revisaIndex(){
  return caches.open(CACHE).then(function(c){
    return c.match(INDEX).then(function(guardado){
      return fetch(new Request(INDEX, {cache:'reload', credentials:'same-origin'}))
        .then(function(r){
          if (!r || !r.ok) return;
          var viejo = guardado && guardado.headers.get('etag');
          var nuevo = r.headers.get('etag');
          return c.put(INDEX, r.clone()).then(function(){
            if (guardado && viejo && nuevo && viejo !== nuevo) return avisaALaApp('nueva-version');
          });
        }).catch(function(){});   /* sin señal: se queda con lo guardado, en silencio */
    });
  });
}

self.addEventListener('message', function(e){
  if (MODO_APAGADO) return;
  if (!e.data || e.data.hb !== 'revisa') return;
  e.waitUntil(revisaIndex());
});

/* EL ARMAZÓN DE LA APP (index.html): se entrega de la bodega al instante y se
   revisa contra el servidor por detrás. Si el ETag cambió, hay versión nueva. */
function armazon(e){
  e.respondWith(
    caches.open(CACHE).then(function(c){
      return c.match(INDEX).then(function(guardado){
        /* ⭐ 31-ago-2026 · «cache:reload» NO estaba, y por eso esto nunca avisaba.
           Sin él, el navegador le contestaba a esta revisión con SU PROPIA copia
           guardada (GitHub Pages manda cache-control de varios minutos): mismo
           ETag siempre, así que nunca detectaba versión nueva. Se comprobó en
           vivo: cuatro recargas seguidas y la app seguía con el paquete viejo.
           Con «reload» la pregunta llega al servidor de verdad, cada vez. */
        var red = fetch(new Request(e.request.url, {cache:'reload', credentials:'same-origin'})).then(function(r){
          if (!r || !r.ok) return r;
          var viejo = guardado && guardado.headers.get('etag');
          var nuevo = r.headers.get('etag');
          return c.put(INDEX, r.clone()).then(function(){
            if (guardado && viejo && nuevo && viejo !== nuevo) return avisaALaApp('nueva-version');
          }).then(function(){ return r; });
        });
        if (guardado){
          e.waitUntil(red.catch(function(){}));   // la revisión sigue aunque ya contestamos
          return guardado;
        }
        return red.catch(function(){ return c.match(INDEX); });   // 1ª vez: de la red
      });
    })
  );
}

/* LO DEMÁS DEL MISMO ORIGEN (supabase.min.js, iconos): de la bodega si está;
   si no, de la red y se guarda. Nunca cambian sin que cambie index.html. */
function estatico(e){
  e.respondWith(
    caches.open(CACHE).then(function(c){
      return c.match(e.request).then(function(hit){
        if (hit) return hit;
        return fetch(e.request).then(function(r){
          if (r && r.ok && r.type === 'basic') c.put(e.request, r.clone());
          return r;
        });
      });
    })
  );
}

self.addEventListener('fetch', function(e){
  if (MODO_APAGADO) return;
  var req = e.request;
  if (req.method !== 'GET') return;                 // nada que escriba
  var url;
  try { url = new URL(req.url); } catch(err){ return; }
  if (url.origin !== self.location.origin) return;  // NADA de Supabase: siempre a la red
  if (url.pathname.indexOf('/videos/') >= 0) return;      // los videos no caben
  if (/\.mp4$|\.webm$|\.mov$/i.test(url.pathname)) return;

  if (req.mode === 'navigate' || (req.headers.get('accept')||'').indexOf('text/html') >= 0){
    // SOLO la app ('/' o '/index.html') se sirve de la bodega. Las demás páginas
    // (prueba.html = el diagnóstico que DEBE funcionar cuando la app no) van
    // SIEMPRE a la red — si aquí sirviéramos el armazón, prueba.html abriría
    // la app en lugar del diagnóstico y nunca más podríamos diagnosticar nada.
    var p = url.pathname.replace(/\/+$/, '/') ;
    if (p === '/' || /\/index\.html$/.test(p)){ armazon(e); }
    return;
  }
  estatico(e);
});
