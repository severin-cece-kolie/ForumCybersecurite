# TECHFORUM 2025 – Backend + Intégration

## Démarrage rapide

1. Installer les dépendances:
```bash
npm install
```

2. Lancer en développement:
```bash
npm run dev
```
Le serveur démarre sur `http://localhost:3000` et sert les pages HTML du dossier racine.

3. Variables d'environnement (optionnel):
- `PORT`: port du serveur (défaut 3000)
- `JWT_SECRET`: secret JWT (défaut: dev_secret_change_me)
- `DATABASE_FILE`: chemin du fichier SQLite (défaut: data.sqlite à la racine)

## Endpoints API

- POST `/api/auth/register` { firstName, lastName, email, password }
- POST `/api/auth/login` { email, password }
- POST `/api/contact` { name, email, subject, message }
- POST `/api/reservations` { ticketType, days[], quantity, firstName, lastName, email, phone?, activities?, comments? }
- GET `/api/forum/topics?category=...`
- POST `/api/forum/topics` (Bearer token) { title, category }
- GET `/api/forum/topics/:id/posts`
- POST `/api/forum/topics/:id/posts` (Bearer token) { content }

Les pages `inscription.html`, `connexion.html`, `contact.html` et `billetterie.html` utilisent `fetch` pour appeler ces endpoints.

## Production

```bash
npm start
```
Servez derrière un reverse proxy (Nginx) si nécessaire.