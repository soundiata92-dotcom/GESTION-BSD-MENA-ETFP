/* Service worker — Gestion Départementale
   Étape 1 du mode hors ligne : l'application s'ouvre sans réseau et les dernières données lues restent consultables.
   Règle de fraîcheur : le réseau est toujours essayé en premier ; le cache ne sert que si le réseau échoue. */
var VERSION = 'v1';
var CACHE_APP = 'gd-app-' + VERSION;      // page + bibliothèques
var CACHE_DONNEES = 'gd-donnees';          // lectures de la base (propres à l'utilisateur connecté)

self.addEventListener('install', function (e) { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (noms) {
            return Promise.all(noms.map(function (n) {
                if (n.indexOf('gd-app-') === 0 && n !== CACHE_APP) return caches.delete(n);
            }));
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'vider-donnees') {
        e.waitUntil(caches.delete(CACHE_DONNEES));
    }
});

function estLectureBase(url) {
    return url.pathname.indexOf('/rest/v1/') === 0 &&
        (/\.supabase\.co$/.test(url.hostname) || url.hostname === self.location.hostname);
}
function estBibliothequeExterne(url) {
    return /(^|\.)(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
}

function reseauPuisCache(requete, nomCache, requeteReseau) {
    return fetch(requeteReseau || requete).then(function (reponse) {
        if (reponse && reponse.status === 200) {
            var copie = reponse.clone();
            caches.open(nomCache).then(function (c) { c.put(requete, copie); });
        }
        return reponse;
    }).catch(function () {
        return caches.open(nomCache).then(function (c) {
            return c.match(requete, { ignoreVary: true }).then(function (r) {
                if (r) return r;
                throw new TypeError('Failed to fetch');
            });
        });
    });
}

function cacheEnPriorite(requete) {
    return caches.open(CACHE_APP).then(function (c) {
        return c.match(requete).then(function (r) {
            if (r) {
                // mise à jour discrète en arrière-plan
                fetch(requete).then(function (rep) { if (rep && rep.status === 200) c.put(requete, rep.clone()); }).catch(function () {});
                return r;
            }
            return fetch(requete).then(function (rep) {
                if (rep && (rep.status === 200 || rep.type === 'opaque')) c.put(requete, rep.clone());
                return rep;
            });
        });
    });
}

self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;
    var url = new URL(req.url);

    if (estLectureBase(url)) {
        e.respondWith(reseauPuisCache(req, CACHE_DONNEES));
        return;
    }
    if (url.origin === self.location.origin) {
        if (req.mode === 'navigate') {
            // la page elle-même : toujours revalidée auprès du réseau, repli sur la dernière version connue
            var cle = new Request(url.origin + '/', { method: 'GET' });
            e.respondWith(reseauPuisCache(cle, CACHE_APP, new Request(req, { cache: 'no-cache' })));
            return;
        }
        e.respondWith(reseauPuisCache(req, CACHE_APP));
        return;
    }
    if (estBibliothequeExterne(url)) {
        e.respondWith(cacheEnPriorite(req));
        return;
    }
});
