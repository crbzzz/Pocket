import '../apps/api/src/env.js';
import {postgres} from '../apps/api/src/postgres.js';
import {readFile} from 'node:fs/promises';
const db=postgres(process.env.DATABASE_URL!);
try{const sql=await readFile('supabase/migrations/202610010003_media_preview.sql','utf8');await db.transaction(async tx=>{for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await tx.query(statement);});console.log('Media and preview schema secured.');}finally{await db.close();}
