# Quick Command Reference

## Setup Commands (Run in Terminal)

```bash
# Navigate to project
cd /Users/mihirbotle/Desktop/Personal/ARhunt

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## After npm install succeeds:

### 1. Start the app:
```bash
npm run dev
```

### 2. Open in browser:
- Main app: http://localhost:3000
- Admin panel: http://localhost:3000/admin

### 3. Admin login:
- Password: `admin123` (or what you set in .env.local)

## Creating Your Hunt

1. Go to http://localhost:3000/admin
2. Create hunt → Set status to "live"
3. Select hunt → Add checkpoints
4. For each checkpoint:
   - Enter title, order, clue
   - Choose unlock method (GPS/QR/Manual)
   - Enter corresponding data

## Testing

1. Open http://localhost:3000 in incognito window
2. Join as "Test Team"
3. Try unlocking checkpoints

## Mobile Testing

Get your local IP:
```bash
# Mac
ipconfig getifaddr en0

# Then access: http://YOUR_IP:3000
```

## Common Issues

**npm install fails:**
```bash
npm cache clean --force
npm install
```

**Port 3000 in use:**
```bash
npm run dev -- -p 3001
```

**Module not found:**
- Make sure `npm install` completed
- Check `node_modules` exists
