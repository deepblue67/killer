// ---------------------------------------------------------------
// Service worker — Dossier Killer
// À chaque mise à jour de l'application, incrémente CACHE_VERSION
// ci-dessous. C'est ce qui permet au navigateur de détecter qu'une
// nouvelle version existe et de proposer la mise à jour au joueur.
// ---------------------------------------------------------------
const CACHE_VERSION = '20260722135643';
const CACHE_NAME = `killer-maison-${CACHE_VERSION}`;

// Fichiers de l'application à mettre en cache pour un fonctionnement
// hors-ligne. Adapte les chemins si tu renommes ou déplaces des fichiers.
const ASSETS_TO_CACHE = [
  './',
  './index.html'
];

// Installation : met en cache les fichiers de l'appli, puis passe
// immédiatement en attente d'activation (sans attendre la fermeture
// des onglets ouverts).
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .catch((err) => console.warn('Mise en cache initiale impossible :', err))
  );
});

// Activation : supprime les anciens caches (anciennes versions) et
// prend immédiatement le contrôle des pages ouvertes.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('killer-maison-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Stratégie réseau-d'abord : on essaie toujours de récupérer la
// dernière version en ligne ; si ça échoue (pas de réseau), on sert
// la version en cache pour que l'appli reste utilisable hors-ligne
// (utile à la montagne si la connexion est capricieuse).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        const responseCopy = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy)).catch(() => {});
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('./index.html'))
      )
  );
});

// Permet à la page de forcer l'activation immédiate d'une nouvelle
// version (déclenché par le bouton "Mettre à jour" dans l'appli).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
