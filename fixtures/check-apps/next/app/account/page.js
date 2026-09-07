import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
export default async function Account() {
  if ((await cookies()).get('glocon-fixture-session')?.value !== 'valid') redirect('/login');
  return <main><h1 id="signed-in">Your account</h1><p>Signed in as a test developer.</p><a href="/">Projects</a></main>;
}
