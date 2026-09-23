import { Db,MongoClient } from "mongodb";

import type { Profile } from '../global_types/profile.ts';
import { Position } from "../global_types/position.ts";

let client : MongoClient | undefined = undefined;
let db : Db | undefined = undefined;

type ProfileWOId = Omit<Profile, 'id'>;

const error_if_needed = ( function_name? : string ) : boolean=>{
  if(client == undefined){
    const error_tag_custom = function_name ? `@ ${function_name}` : '';
    console.error(`[CLIENT ERROR ${error_tag_custom}] mongo db client not initilized`);
    return true;
  }
  else if(db == undefined){
    const error_tag_custom = function_name ? `@ ${function_name}` : '';
    console.error(`[DATABASE ERROR ${error_tag_custom}] mongo db database not found`);
    return true;
  }
  return false;
}

export const init_db = async() : Promise<boolean>=>{

  if(client == undefined){
    console.warn('mongodb client is not defined, initilizing');
    try{
      client = new MongoClient('mongodb://127.0.0.1:27017');
      await client.connect();
      db = client.db('seperated_out_db');

      //there will be some more, i think?

      console.log('[CLIENT AND DB INITILIZED]');

      return true;
    }
    catch(err){
      console.log(`[CLIENT INITILIZATION ERROR] ${err}`);
      return false;
    }
  }
  if(db == undefined){
    console.warn('mongodb instance not defined, initilizing')
    try{
      db = client.db('seperated_out_db');
      console.log('[DB INITILIZIED]');
      return true;
    }
    catch(err){
      console.log(`[CLIENT INITILIZATION ERROR] ${err}`);
      return false;
    }
  }
  
  return true;
};

export const get_profiles = async() : Promise<Profile[]>=>{

  if(!error_if_needed()){

    let res =  await db!.collection<Profile>('profiles')
    .find()
    .toArray();

    return res;
  }

  return [];

};

export const get_positions = async() : Promise<Position[]>=>{

  if(!error_if_needed()){
    let res = await db!.collection<Position>('positions')
    .find()
    .toArray();

    return res;
  }

  return [];
};

const get_profile_count = async() : Promise<number> =>{

  const res = await db!.collection('profiles')
  .find()
  .toArray();

  return res.length;

};

export const add_profile = async ( profile : Profile ) : Promise<boolean>=>{
  if(!error_if_needed()){

    const id2add = await get_profile_count();

    profile.id = id2add;

    await db!.collection('profiles').insertOne( profile );
    return true;
  }
  return false;
};

export const edit_profile = async(id : number, new_values : Partial<ProfileWOId>) 
: Promise<boolean>=>{

  if(!error_if_needed()){

    try{

      //if the unintended fields are being set to 'null' or smt similar, this is the reason
      await db!.collection('profiles').updateOne(
        { id : parseInt(id) },
        { $set : new_values }
      );

      return true;
    }
    catch(err){
      console.error(`[EDIT PROFILE ERROR] ${err}`);
      return false;
    }
  }
  return false;
};

export const add_position = (obj : ProfileWOId): boolean=>{
  if(!error_if_needed()){

    db!.collection('positions').insertOne( obj );

  }
  return false;
};
