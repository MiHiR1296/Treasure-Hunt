import { NextRequest } from 'next/server';
import { handle,jsonBody,requireSession,textField } from '@/lib/server/http';
import { deleteHunt } from '@/lib/server/media';
export const runtime='nodejs';
export async function POST(request:NextRequest){return handle(async()=>{await requireSession(request,'admin');const body=await jsonBody(request);await deleteHunt(textField(body,'huntId'),textField(body,'confirmation'));return {ok:true};});}
