#!/bin/bash

# Update .env.local with correct API key

cat > .env.local << 'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://wjvezuqrygbzbvnoyxuk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqdmV6dXFyeWdiemJ2bm95eHVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNzIxMjIsImV4cCI6MjA4NDY0ODEyMn0.LrmHLig5HvISl5xvf5vgatrihb5bFKw0Hv9bJzfY7JY
NEXT_PUBLIC_ADMIN_PASSWORD=admin123
EOF

echo "✅ Updated .env.local with correct API key!"
echo ""
echo "Next: Restart your dev server with 'npm run dev'"
