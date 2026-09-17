# Fix npm Permission Issues

## The Problem
Your npm cache has root-owned files that need to be fixed.

## Quick Fix (Run in Terminal)

```bash
# Fix npm cache permissions
sudo chown -R $(whoami) "/Users/mihirbotle/.npm"

# Then install dependencies
cd /Users/mihirbotle/Desktop/Personal/ARhunt
npm install --legacy-peer-deps
```

## Alternative: Use Yarn Instead

If npm continues to have issues, you can use Yarn:

```bash
# Install Yarn (if not installed)
npm install -g yarn

# Then use Yarn instead
cd /Users/mihirbotle/Desktop/Personal/ARhunt
yarn install
yarn dev
```

## After Installation Succeeds

Once dependencies are installed:

```bash
# Start the development server
npm run dev
# or
yarn dev
```

Then open http://localhost:3000

## Next Steps

1. ✅ Fix permissions (run the sudo command above)
2. ✅ Install dependencies (`npm install --legacy-peer-deps`)
3. ✅ Start server (`npm run dev`)
4. ✅ Go to http://localhost:3000/admin
5. ✅ Create your hunt and add checkpoints
