// Test script to verify Supabase connection
// Run with: npx tsx scripts/test-connection.ts

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wjvezuqrygbzbvnoyxuk.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_fCAANjDS5LjmlRp6xtB7aQ_kZRgrziF';

console.log('Testing Supabase connection...');
console.log('URL:', supabaseUrl);
console.log('Key:', supabaseKey.substring(0, 20) + '...');

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  try {
    // Test 1: Check if we can query teams table
    console.log('\n1. Testing teams table...');
    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('count')
      .limit(1);

    if (teamsError) {
      console.error('❌ Error querying teams:', teamsError.message);
      if (teamsError.message.includes('relation') || teamsError.message.includes('does not exist')) {
        console.error('\n⚠️  Database tables not found!');
        console.error('Please run the SQL schema from supabase/schema.sql in your Supabase SQL Editor.');
        return;
      }
      if (teamsError.message.includes('JWT') || teamsError.message.includes('Invalid API key')) {
        console.error('\n⚠️  Invalid API key!');
        console.error('Please check your NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
        console.error('Get the correct key from: Supabase Dashboard → Settings → API → anon public');
        return;
      }
      throw teamsError;
    }

    console.log('✅ Teams table accessible');

    // Test 2: Check hunts table
    console.log('\n2. Testing hunts table...');
    const { data: hunts, error: huntsError } = await supabase
      .from('hunts')
      .select('count')
      .limit(1);

    if (huntsError) {
      console.error('❌ Error querying hunts:', huntsError.message);
      return;
    }
    console.log('✅ Hunts table accessible');

    // Test 3: Check checkpoints table
    console.log('\n3. Testing checkpoints table...');
    const { data: checkpoints, error: checkpointsError } = await supabase
      .from('checkpoints')
      .select('count')
      .limit(1);

    if (checkpointsError) {
      console.error('❌ Error querying checkpoints:', checkpointsError.message);
      return;
    }
    console.log('✅ Checkpoints table accessible');

    console.log('\n🎉 All tests passed! Your Supabase connection is working.');
    console.log('\nNext steps:');
    console.log('1. Go to /admin to create your first hunt');
    console.log('2. Add checkpoints with Lokdhara locations');
    console.log('3. Set hunt status to "live"');

  } catch (error: any) {
    console.error('\n❌ Connection test failed:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Verify .env.local exists with correct credentials');
    console.error('2. Check Supabase project is active');
    console.error('3. Ensure database schema is set up (run supabase/schema.sql)');
  }
}

testConnection();
