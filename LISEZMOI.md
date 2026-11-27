# Registre des pintades : version GitHub

Adresse de l'appli : https://theoviatge.github.io/registre-pintades/

- Marche **sans réseau** : une fois ouverte une première fois avec du réseau, elle reste dans le téléphone (« Ajouter à l'écran d'accueil »).
- Chaque saisie est gardée dans le téléphone, puis envoyée à la feuille Google **« Pintades – synchro »** (Drive › SYNCHRONISATION) dès qu'il y a du réseau. Les autres téléphones récupèrent les nouveautés toutes les 15 secondes.
- Une **sauvegarde part chaque soir par mail** (fichier .json), seulement s'il y a eu des saisies.
- **Mises à jour automatiques** : quand l'appli change sur GitHub, le téléphone prend la nouvelle version à l'ouverture suivante avec du réseau.

Le dépôt ne contient **aucune donnée de l'élevage**, seulement l'appli.

## Relier la feuille Google (une seule fois)

1. Ouvrir la feuille « Pintades – synchro » dans Drive › SYNCHRONISATION.
2. Menu **Extensions › Apps Script**. Effacer ce qui est écrit et coller le contenu de [`apps-script/Code.gs`](apps-script/Code.gs). Enregistrer.
3. **Déployer › Nouveau déploiement**, type **Application Web**, « Exécuter en tant que : **moi** », « Qui a accès : **Tout le monde** ». Autoriser l'accès demandé.
4. Copier l'adresse qui finit par `/exec` et la mettre dans `config.js`.
5. Dans l'éditeur Apps Script, choisir la fonction **installerSauvegarde** en haut et cliquer **Exécuter** : c'est ce qui lance la sauvegarde du soir par mail.

Le code d'accès des téléphones est dans l'onglet caché `_reglages` de la feuille (case A2). L'appli le demande une seule fois par téléphone.

Les onglets **Lots**, **Départs** et **Mortalités** de la feuille se refont tout seuls à chaque saisie : ne pas les modifier à la main. L'onglet caché `_sync` sert à la synchronisation : ne pas y toucher.

## Remettre une sauvegarde

Dans l'appli : **Lots › Données › Importer un fichier**, et choisir le fichier .json reçu par mail. L'import ajoute seulement les saisies qui manquent, il n'efface rien.
