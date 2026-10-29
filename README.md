# Compteur 10 000

Le compteur de points du jeu de dés 10 000 : chacun note son score sur son téléphone, et tout le monde suit le classement en direct.

**Jouer :** https://dam29830.github.io/compteur-10000/

- « Nouvelle partie » affiche un QR code et un code de 4 caractères.
- Les joueurs scannent le QR code, tapent leur prénom, puis notent leurs points à la fin de chaque tour.
- Les règles de la maison se règlent sur l'écran de partie : objectif, minimum pour entrer, minimum par tour, finir pile, 3 croix.

Les scores passent par une base Firebase Realtime Database, dont l'adresse se trouve dans `config.js`.
