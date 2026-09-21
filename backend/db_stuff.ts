import { Db,MongoClient } from "mongodb";

import type { Profile } from '../global_types/profile.ts';
import { Position } from "../global_types/position.ts";



let client : MongoClient | undefined = undefined;
let db : Db | undefined = undefined;

const error_if_needed = ( function_name? : string ) : boolean=>{
  if(client == undefined){
    console.error(`[CLIENT ERROR ${function_name ? `@ ${function_name}` : ''}] mongo db client not initilized`);
    return false;
  }
  else if(db == undefined){
    console.error(`[DATABASE ERROR ${function_name ? `@ ${function_name}` : ''}] mongo db database not found`);
    return false;
  }
  return true;
}

export const init_db = async()=>{

  if(client == undefined){
    client = new MongoClient('mongodb://127.0.0.1:27017');
    await client.connect();
    db = client.db('seperated_out_db');

    //there will be some more
  }

};

export const get_profiles = async() : Promise<Profile[]>=>{

  if(!error_if_needed()){
    return await db!.collection<Profile>('Profiles')
    .find()
    .toArray();
  }

  return [];

};

export const get_positions = async() : Promise<Position[]>=>{

  if(!error_if_needed()){
    return await db!.collection<Position>('positions')
    .find()
    .toArray();
  }

  return [];
};

export const add_profile = async ( profile : Omit<Profile, 'id'> )=>{
  if(!error_if_needed()){
    await db!.collection('profiles').insertOne( profile );
  }
};

export const edit_profile = async(id : number, new_values : Partial<Omit< Profile, 'id' >>) : Promise<boolean>=>{
  if(!error_if_needed()){

    await db!.collection('profiles').updateOne(
      { id : id },
      { $set : new_values }//if the unintended fields are being set to 'null' or smt similar, this is the reason
    );

    return true;
  }
  return false;
};

export const add_position = (obj : Omit< Profile, 'id' >): boolean=>{
  if(!error_if_needed()){

    db!.collection('positions').insertOne( obj );

  }
  return false;
};
