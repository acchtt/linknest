/** Temporary, non-sensitive connectivity probe. Remove after diagnosis. */
export const onRequestGet = async ({ request, env }) => {
  const u = new URL(request.url);
  if (u.searchParams.get('probe') !== '1') return new Response('Not found', { status: 404 });
  const expectedHost = 'linknest-resolver-production.up.railway.app';
  const expected = `https://${expectedHost}/api/resolve`;
  const configured = String(env.RESOLVER_API_URL || '').trim();
  let parsed = null;
  try { parsed = new URL(configured); } catch {}
  const details = {
    configured: Boolean(configured),
    resolverUrlMatches: Boolean(parsed && parsed.href === expected),
    expectedHostMatches: Boolean(parsed && parsed.hostname === expectedHost),
    authConfigured: Boolean(env.RESOLVER_API_KEY),
    signingSecretConfigured: String(env.DOWNLOAD_SIGNING_SECRET || '').length >= 32,
    directStatus: null,
    directErrorType: null,
    directErrorMessage: null,
    simpleFetchStatus: null,
    simpleFetchError: null,
  };
  try {
    const response = await fetch(`https://${expectedHost}/health`, {
      redirect: 'error', signal: AbortSignal.timeout(7000)
    });
    details.directStatus = response.status;
  } catch (e) {
    details.directErrorType = String(e?.name || 'Error').slice(0, 40);
    details.directErrorMessage = String(e?.message || 'Unknown').slice(0, 180);
  }
  try {
    const response = await fetch(`https://${expectedHost}/health`);
    details.simpleFetchStatus = response.status;
  } catch (e) {
    details.simpleFetchError = `${String(e?.name || 'Error')}: ${String(e?.message || 'Unknown').slice(0, 180)}`;
  }
  return Response.json(details, { headers: { 'Cache-Control': 'no-store' } });
};
