#!/bin/bash

# Deployment script for Treasure Hunt app
# GitHub: https://github.com/MiHiR1296

echo "🚀 Treasure Hunt Deployment Script"
echo "=================================="
echo ""

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "📦 Initializing git repository..."
    git init
    echo "✅ Git initialized"
else
    echo "✅ Git already initialized"
fi

# Check if .env.local exists and warn
if [ -f ".env.local" ]; then
    echo "⚠️  Note: .env.local will NOT be pushed to GitHub (it's in .gitignore)"
    echo "   Make sure to add environment variables in Vercel!"
fi

echo ""
echo "📝 Next steps:"
echo ""
echo "1. Create a GitHub repository:"
echo "   Go to: https://github.com/new"
echo "   Name it: treasure-hunt (or any name)"
echo "   Make it Public (for free Vercel)"
echo "   DO NOT initialize with README"
echo ""
echo "2. After creating the repo, run these commands:"
echo ""
echo "   git add ."
echo "   git commit -m 'Initial commit - Republic Day Treasure Hunt'"
echo "   git remote add origin https://github.com/MiHiR1296/YOUR_REPO_NAME.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
echo "   (Replace YOUR_REPO_NAME with the repository name you created)"
echo ""
echo "3. Then go to https://vercel.com and:"
echo "   - Sign up with GitHub"
echo "   - Import your repository"
echo "   - Add environment variables (see DEPLOY_NOW.md)"
echo "   - Deploy!"
echo ""
echo "📖 See DEPLOY_NOW.md for detailed instructions"
echo ""
