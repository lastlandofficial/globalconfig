export async function POST(request) {
  return new Response(null, { status: 303, headers: { Location: '/account', 'Set-Cookie': 'glocon-fixture-session=valid; Path=/; HttpOnly; SameSite=Lax' } });
}
