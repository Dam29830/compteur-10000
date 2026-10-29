# Compteur 10 000

Le compteur de points du jeu de dés 10 000 : chacun note son score sur son téléphone, et tout le monde suit le classement en direct.

**Jouer :** https://dam29830.github.io/compteur-10000/

- « Créer une partie » affiche un QR code et un code de 4 caractères.
- Les joueurs scannent le QR code, tapent leur prénom, puis notent leurs points à la fin de chaque tour.
- Le bouton « Menu » permet de mettre la partie en pause, de la clôturer, de recommencer ou de l'effacer.
- Réglages de la partie : objectif, 1 000 points pour entrer, minimum par tour, finir pile, 3 croix.

Les scores passent par une base Firebase Realtime Database, dont l'adresse se trouve dans `config.js`.
Les règles de sécurité de la base sont dans `regles-firebase.json` (à coller dans la console Firebase, onglet Règles).
