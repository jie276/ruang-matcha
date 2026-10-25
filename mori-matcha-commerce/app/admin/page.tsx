import {redirect} from 'next/navigation';
import {admin} from '@/lib/server';
import Admin from '@/components/admin';
export const dynamic='force-dynamic';
export default async function Page(){try{await admin()}catch{redirect('/admin/login')}return <Admin/>}
