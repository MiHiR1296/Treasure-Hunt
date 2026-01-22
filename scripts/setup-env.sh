#!/bin/bash

# Create .env.local file with Supabase credentials
cat > .env.local << EOF
NEXT_PUBLIC_SUPABASE_URL=https://wjvezuqrygbzbvnoyxuk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_fCAANjDS5LjmlRp6xtB7aQ_kZRgrziF
NEXT_PUBLIC_ADMIN_PASSWORD=admin123
EOF

echo "✅ Created .env.local file"
echo ""
echo "⚠️  Note: The keys you provided look different from standard Supabase JWT keys."
echo "   If you encounter authentication errors, please check:"
echo "   1. Go to Supabase Dashboard → Settings → API"
echo "   2. Copy the 'anon public' key (should start with 'eyJ')"
echo "   3. Update NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
echo ""
