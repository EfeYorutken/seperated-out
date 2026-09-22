//line 107
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

    res = res.map(d => { return d.profile; });

    console.log(`sending back the profle ${JSON.stringify(res)}`);

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

export const add_profile = async ( profile : ProfileWOId ) : Promise<boolean>=>{
  if(!error_if_needed()){
    console.log('adding profile');
    await db!.collection('profiles').insertOne( profile );
    return true;
  }
  return false;
};

export const edit_profile = async(id : number, new_values : Partial<ProfileWOId>) 
: Promise<boolean>=>{
  if(!error_if_needed()){

    //THIS IS THE PROBLEM, RUN AND CHECK THE DB FOR FIELDS
    console.log('editing profile');
    new_values.id = id;
    await db!.collection('profiles').updateOne(
      { id : id },
      //if the unintended fields are being set to 'null' or smt similar, this is the reason
      { $set : new_values }
    );

    return true;
  }
  return false;
};

export const add_position = (obj : ProfileWOId): boolean=>{
  if(!error_if_needed()){

    db!.collection('positions').insertOne( obj );

  }
  return false;
};
