describe('getSupabaseConfig', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  afterEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it('throws when the Supabase URL is missing', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    const { getSupabaseConfig } = require('../../src/lib/supabaseConfig');
    expect(() => getSupabaseConfig()).toThrow(/Missing EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('returns the config when both env vars are present', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    const { getSupabaseConfig } = require('../../src/lib/supabaseConfig');
    expect(getSupabaseConfig()).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'test-anon-key',
    });
  });
});
