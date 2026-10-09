import { Db,MongoClient,ObjectId } from "mongodb";

import type { Profile } from '../global_types/profile.ts';
import type { Position } from "../global_types/position.ts";

import { bucket_window, crawl_interval_ms } from './interval.ts';

let client : MongoClient | undefined = undefined;
let db : Db | undefined = undefined;
//which database the handle above is pointed at, clear() reads this to stay away
//from real data
let active_db_name = '';

//the smoke tests empty whole collections, so they must never be able to point
//at the database the app actually uses
const APP_DB = 'seperated_out_db';
const TEST_DB = 'seperated_out_test_db';

type ProfileWOId = Omit<Profile, 'id'>;

//what a position looks like once mongo has actually stored it. build_position
//cannot know the _id, it only exists from the insert onwards
type StoredPosition = Position & { _id? : ObjectId };

export type DorkHoldCause = 'captcha' | 'consent';
export type DorkHoldState = 'HOLDING' | 'SOLVING' | 'SOLVED' | 'DISCARDED';
//whether the dork that was blocked belonged to a scheduled tick or to the
//recording flow. the tick dedupes its holds per profile, the recording never
//does: two drafts can both point at the same unsaved profile id
export type DorkHoldPurpose = 'tick' | 'recording';

export type DorkHold = {
  id : string;
  profile_id : number;
  profile_name : string;
  //the exact query google blocked, the solve window opens it again
  dork : string;
  cause : DorkHoldCause;
  state : DorkHoldState;
  //whether a tick or a recording session is behind it, so an auto resume can
  //tell the two apart
  purpose : DorkHoldPurpose;
  created_at : string;
  solved_at : string | null;
};

//a stored profile predating any of the list fields simply has no list, and a
//null there would reach the form and the crawl as a missing list. callers
//should never have to know that
const with_defaults = ( profile : Profile ) : Profile => {
  return {
    ...profile,
    platform_domain : profile.platform_domain ?? '',
    url_section : profile.url_section ?? '',
    publish_after : profile.publish_after ?? null,
    post_selector : [ ...(profile.post_selector ?? []) ],
    description_selector : [ ...(profile.description_selector ?? []) ],
    keywords : [ ...(profile.keywords ?? []) ],
    anti_keywords : [ ...(profile.anti_keywords ?? []) ]
  };
};

export type SeenHash = {
  hash : string;
  profile_id : number;
  profile_name : string;
  url : string;
  recorded_at : Date;
};

//the uniqueness is what actually stops a posting from being stored twice, the
//hash_known check in front of it is only a cheap fast path
const ensure_hash_index = async() : Promise<void>=>{
  await db!.collection('hashes').createIndex({ hash : 1 }, { unique : true });
  console.log('[HASH INDEX READY]');
};

//mongo raises this code when two crawls race the hash_known check
export const is_duplicate_key = ( err : unknown ) : boolean => {
  return typeof err === 'object' && err !== null && (err as { code? : number }).code === 11000;
};

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
};


export const init_db = async(db_name : string = APP_DB) : Promise<boolean>=>{

  if(client == undefined){
    console.warn('mongodb client is not defined, initilizing');
    try{
      client = new MongoClient('mongodb://127.0.0.1:27017');
      await client.connect();
      db = client.db(db_name);
      active_db_name = db_name;

      await ensure_hash_index();

      //there will be some more, i think?

      console.log(`[CLIENT AND DB INITILIZED] ${db_name}`);

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
      db = client.db(db_name);
      active_db_name = db_name;
      console.log('[DB INITILIZIED]');
      return true;
    }
    catch(err){
      console.log(`[CLIENT INITIALIZATION ERROR] ${err}`);
      return false;
    }
  }
  
  return true;
};

//the only supported way for a test to get a handle on the database, it can not
//reach seperated_out_db and so a stray deleteMany in a test is harmless
export const init_test_db = async() : Promise<boolean> => {
  return await init_db(TEST_DB);
};

/*
 * an open client keeps deno's event loop alive, so a script that is done with
 * the database still hangs around until something kills it. a smoke test has
 * to call this or it never exits
 */
export const close_db = async() : Promise<void> => {

  const dying = client;
  client = undefined;
  db = undefined;
  active_db_name = '';

  if(dying){ await dying.close().catch(() => {}); }

};

export const get_profiles = async() : Promise<Profile[]>=>{

  if(!error_if_needed()){

    let res =  await db!.collection<Profile>('profiles')
    .find()
    .sort({ id : 1 })
    .toArray();

    return res.map( with_defaults );

  }

  return [];

};

export const get_positions = async() : Promise<Position[]>=>{

  if(!error_if_needed()){

    const res = await db!.collection<StoredPosition>('positions')
    .find()
    .toArray();

    //a stored position carries no id of its own, only the one mongo put there,
    //and the remove button has nothing to address it by without this
    return res.map((position) => ({
      ...position,
      id : position._id?.toHexString()
    }));

  }

  return [];
};

//a count would hand the id of a deleted profile to the next one created, and
//that id would then belong to two profiles at once
const next_profile_id = async() : Promise<number> =>{

  const newest = await db!.collection('profiles')
  .find({}, { sort : { id : -1 }, limit : 1, projection : { id : 1 } })
  .next();

  return (newest?.id ?? -1) + 1;

};

export const add_profile = async ( profile : Profile ) : Promise<boolean>=>{
  if(!error_if_needed()){

    profile.id = await next_profile_id();

    await db!.collection('profiles').insertOne( with_defaults(profile) );
    return true;
  }
  return false;
};

export const edit_profile = async(id : number | string, new_values : Partial<ProfileWOId>) 
: Promise<boolean>=>{

  if(!error_if_needed()){

    try{

      //graphql serializes an ID as a string, mongo stored these as numbers, a
      //plain filter on "0" matches nothing at all and the edit silently no-ops
      const numeric_id = Number(id);

      if(!Number.isFinite(numeric_id)){
        console.error(`[EDIT PROFILE ERROR] '${id}' is not a profile id`);
        return false;
      }

      const { id : _ignored, ...changes } = new_values as Partial<ProfileWOId> & { id? : number };

      //and $setting it back would flip the stored number into a string
      const result = await db!.collection('profiles').updateOne(
        { id : numeric_id },
        { $set : changes }
      );

      if(result.matchedCount === 0){
        console.error(`[EDIT PROFILE ERROR] no profile has id ${numeric_id}`);
        return false;
      }

      return true;
    }
    catch(err){
      console.error(`[EDIT PROFILE ERROR] ${err}`);
      return false;
    }
  }
  return false;
};

//graphql hands an ID over as a string while these are stored as numbers, the
//same coercion edit_profile has to do
const profile_id_as_number = ( id : number | string ) : number | null => {
  const numeric_id = Number(id);
  if(!Number.isFinite(numeric_id)){
    console.error(`[PROFILE ERROR] '${id}' is not a profile id`);
    return null;
  }
  return numeric_id;
};

//walks name, name 2, name 3 ... until it finds one nothing else is using, so
//cloning the same profile twice can never produce two rows with one name
const unused_profile_name = async( wanted : string ) : Promise<string> => {

  const taken = new Set(
    (await db!.collection('profiles')
    .find({}, { projection : { name : 1 } })
    .toArray())
    .map((row) => row.name)
  );

  if(!taken.has(wanted)){ return wanted; }

  for(let suffix = 2; suffix < 100000; suffix++){
    const candidate = `${wanted} ${suffix}`;
    if(!taken.has(candidate)){ return candidate; }
  }

  //unreachable in practice, a timestamp is the last resort
  return `${wanted} ${Date.now()}`;

};

export const clone_profile = async( id : number | string ) : Promise<boolean> => {

  if(error_if_needed('clone_profile')){ return false; }

  try{

    const numeric_id = profile_id_as_number(id);
    if(numeric_id === null){ return false; }

    const source = await db!.collection<Profile>('profiles')
    .findOne({ id : numeric_id });

    if(!source){
      console.error(`[CLONE PROFILE ERROR] no profile has id ${numeric_id}`);
      return false;
    }

    //_id comes off too, mongo generates that one and keeping the original
    //would collide with the profile being copied
    const { id : _discarded, _id : _also_discarded, ...rest } = source;

    //every attribute is carried over as it was, and every list is copied so
    //editing the clone can never reach back into the original. the id is the
    //one exception, add_profile hands the copy a fresh one
    const copy : Profile = {
      ...rest,
      id : -1,
      name : await unused_profile_name(source.name),
      post_selector : [ ...(rest.post_selector ?? []) ],
      description_selector : [ ...(rest.description_selector ?? []) ],
      keywords : [ ...(rest.keywords ?? []) ],
      anti_keywords : [ ...(rest.anti_keywords ?? []) ]
    };

    return await add_profile( copy );

  }
  catch(err){
    console.error(`[CLONE PROFILE ERROR] ${err}`);
    return false;
  }

};

//only the profile itself goes. the positions it found and the hashes that
//back them are deliberately left behind, a posting does not belong to the
//profile that happened to run into it
export const delete_profile = async( id : number | string ) : Promise<boolean> => {

  if(error_if_needed('delete_profile')){ return false; }

  try{

    const numeric_id = profile_id_as_number(id);
    if(numeric_id === null){ return false; }

    const result = await db!.collection('profiles').deleteOne({ id : numeric_id });

    if(result.deletedCount === 0){
      console.error(`[DELETE PROFILE ERROR] no profile has id ${numeric_id}`);
      return false;
    }

    return true;

  }
  catch(err){
    console.error(`[DELETE PROFILE ERROR] ${err}`);
    return false;
  }

};

/*
 * a validator that no position can satisfy, so add_position is guaranteed to
 * fail. this exists for the smoke test that proves a failed insert leaves no
 * hash behind: the failure has to be real, not a mocked out return value
 */
export const expire_every_position = async() : Promise<boolean> => {

  if(error_if_needed('expire_every_position')){ return false; }

  try{
    await db!.command({
      collMod : 'positions',
      validator : { job_title : { $eq : 'this text can never be stored' } },
      validationAction : 'error'
    });
    return true;
  }
  catch(err){
    console.error(`[EXPIRE POSITION ERROR] ${err}`);
    return false;
  }

};

export const stop_expiring_positions = async() : Promise<boolean> => {

  if(error_if_needed('stop_expiring_positions')){ return false; }

  try{
    await db!.command({ collMod : 'positions', validator : {}, validationAction : 'warn' });
    return true;
  }
  catch(err){
    console.error(`[STOP EXPIRING ERROR] ${err}`);
    return false;
  }

};

export const add_position = async ( position : Position ) : Promise<boolean>=>{

  if(!error_if_needed()){
    try{
      await db!.collection<Position>('positions').insertOne( position );
      return true;
    }
    catch(err){
      console.error(`[ADD POSITION ERROR] ${err}`);
      return false;
    }
  }
  return false;
};

/*
 * drops the found position and leaves its hash alone, so the crawler still
 * counts that posting as seen and will not put it back. the mirror image of
 * forgetting a hash, which drops the dedupe record and keeps the position
 */
export const remove_position = async( id : number | string ) : Promise<boolean> => {

  if(error_if_needed('remove_position')){ return false; }

  try{

    const wanted = String(id).trim();

    //a malformed id has to be refused, ObjectId would otherwise throw
    if(!ObjectId.isValid(wanted)){
      console.error(`[REMOVE POSITION ERROR] '${wanted}' is not a position id`);
      return false;
    }

    const result = await db!.collection('positions')
    .deleteOne({ _id : new ObjectId(wanted) });

    if(result.deletedCount === 0){
      console.error(`[REMOVE POSITION ERROR] no position has id ${wanted}`);
      return false;
    }

    return true;

  }
  catch(err){
    console.error(`[REMOVE POSITION ERROR] ${err}`);
    return false;
  }

};

export const hash_known = async( hash : string ) : Promise<boolean>=>{

  if(!error_if_needed('hash_known')){
    try{
      const found = await db!.collection('hashes')
      .findOne({ hash : hash }, { projection : { _id : 1 } });

      return found != null;
    }
    catch(err){
      console.error(`[HASH LOOKUP ERROR] ${err}`);
      //assume unseen on a lookup failure, remembering the hash will still be
      //guarded by the unique index
      return false;
    }
  }
  return true;
};

//rejects a duplicate key by throwing, that is the race guard
export const remember_hash = async( seen : SeenHash ) : Promise<boolean>=>{

  if(!error_if_needed('remember_hash')){
    try{
      await db!.collection('hashes').insertOne( seen );
      return true;
    }
    catch(err){
      if(!is_duplicate_key(err)){ console.error(`[REMEMBER HASH ERROR] ${err}`); }
      return false;
    }
  }
  return false;
};

/*
 * the mirror image of remember_hash, kept for when a stored position has to be
 * un-seen. store_position in scheduler.ts writes the position before the hash,
 * so a failed insert needs no unwind and nothing calls this on that path any
 * more. the two are a pair and the pairing is the point: a hash with no
 * position behind it tells the crawler a posting was seen when it was not
 */
export const forget_hash = async( hash : string ) : Promise<boolean>=>{

  if(!error_if_needed('forget_hash')){
    try{
      await db!.collection('hashes').deleteOne({ hash : hash });
      return true;
    }
    catch(err){
      console.error(`[FORGET HASH ERROR] ${err}`);
      return false;
    }
  }
  return false;
};

export const count_hashes = async() : Promise<number>=>{

  if(!error_if_needed('count_hashes')){
    return await db!.collection('hashes').countDocuments();
  }
  return -1;
};

/*
 * a blocked dork, kept until the user has either solved it or thrown it away.
 * the same profile held while one of these is still open does not write a
 * second row, that would bury the solve button under identical copies
 */
export const hold_dork = async(
  profile : Profile,
  dork : string,
  cause : DorkHoldCause,
  purpose : DorkHoldPurpose
) : Promise<DorkHold | null> => {

  if(error_if_needed('hold_dork')){ return null; }

  try{

    if(purpose === 'tick'){
      const open = await db!.collection<DorkHold>('dork_holds').findOne({
        profile_id : profile.id,
        state : { $in : [ 'HOLDING', 'SOLVING' ] }
      });
      if(open){ return open; }
    }

    const hold : DorkHold = {
      id : crypto.randomUUID(),
      profile_id : profile.id,
      profile_name : profile.name,
      dork,
      cause,
      state : 'HOLDING',
      purpose,
      created_at : new Date().toISOString(),
      solved_at : null
    };

    await db!.collection('dork_holds').insertOne(hold);
    return hold;

  }
  catch(err){
    console.error(`[HOLD DORK ERROR] ${err}`);
    return null;
  }

};

export const find_dork_hold = async( id : string ) : Promise<DorkHold | null> => {

  if(error_if_needed('find_dork_hold')){ return null; }

  try{
    return await db!.collection<DorkHold>('dork_holds').findOne({ id });
  }
  catch(err){
    console.error(`[FIND HOLD ERROR] ${err}`);
    return null;
  }

};

//the newest fifty, resolved ones stay around as a record but a page of
//hundreds of old rows is nobody's idea of a list
export const list_dork_holds = async() : Promise<DorkHold[]> => {

  if(error_if_needed('list_dork_holds')){ return []; }

  try{
    return await db!.collection<DorkHold>('dork_holds')
      .find()
      .sort({ created_at : -1 })
      .limit(50)
      .toArray();
  }
  catch(err){
    console.error(`[LIST HOLDS ERROR] ${err}`);
    return [];
  }

};

export const mark_dork_hold_solving = async( id : string ) : Promise<boolean> => {

  if(error_if_needed('mark_dork_hold_solving')){ return false; }

  try{
    await db!.collection('dork_holds').updateOne(
      { id },
      { $set : { state : 'SOLVING' } }
    );
    return true;
  }
  catch(err){
    console.error(`[MARK SOLVING ERROR] ${err}`);
    return false;
  }

};

//an abort or a failed launch puts a hold back on the shelf, nothing was solved
export const mark_dork_hold_holding = async( id : string ) : Promise<boolean> => {

  if(error_if_needed('mark_dork_hold_holding')){ return false; }

  try{
    await db!.collection('dork_holds').updateOne(
      { id },
      { $set : { state : 'HOLDING' } }
    );
    return true;
  }
  catch(err){
    console.error(`[MARK HOLDING ERROR] ${err}`);
    return false;
  }

};

export const resolve_dork_hold = async( id : string ) : Promise<boolean> => {

  if(error_if_needed('resolve_dork_hold')){ return false; }

  try{
    await db!.collection('dork_holds').updateOne(
      { id },
      { $set : { state : 'SOLVED', solved_at : new Date().toISOString() } }
    );
    return true;
  }
  catch(err){
    console.error(`[RESOLVE HOLD ERROR] ${err}`);
    return false;
  }

};

export const dismiss_dork_hold = async( id : string ) : Promise<boolean> => {

  if(error_if_needed('dismiss_dork_hold')){ return false; }

  try{
    const answer = await db!.collection('dork_holds').updateOne(
      { id },
      { $set : { state : 'DISCARDED' } }
    );

      //a hold that is not on the shelf cannot be thrown away, and the panel
      //wants to hear that rather than a cheerful true
      return answer.matchedCount > 0;
  }
  catch(err){
    console.error(`[DISMISS HOLD ERROR] ${err}`);
    return false;
  }

};

export type SeriesPoint = { at : string; total : number };

export type ProfileSeries = {
  profile_id : number;
  profile_name : string;
  points : SeriesPoint[];
};

export type PositionsOverTime = {
  bucket_ms : number;
  crawl_interval_ms : number;
  generated_at : string;
  series : ProfileSeries[];
};

type RawBucket = {
  _id : { bucket : number; profile_id : number; profile_name : string };
  running_total : number;
};

//positions carry no timestamp at all, the hashes collection does, and it holds
//exactly one row per stored position, so it is the time series
const bucket_hashes = async( bucket_ms : number, since : Date ) : Promise<RawBucket[]> => {

  return await db!.collection('hashes').aggregate<RawBucket>([

    { $match : { recorded_at : { $gte : since } } },

    //floor of epoch over the width, this is what lets the width be any number
    //of milliseconds instead of only whole seconds, minutes or days
    {
      $set : {
        bucket : { $floor : { $divide : [ { $toLong : '$recorded_at' }, bucket_ms ] } }
      }
    },

    {
      $group : {
        _id : {
          bucket : '$bucket',
          profile_id : '$profile_id',
          profile_name : '$profile_name'
        },
        added : { $sum : 1 }
      }
    },

    { $sort : { '_id.bucket' : 1 } },

    {
      $setWindowFields : {
        partitionBy : '$_id.profile_id',
        sortBy : { '_id.bucket' : 1 },
        output : {
          running_total : {
            $sum : '$added',
            window : { documents : [ 'unbounded', 'current' ] }
          }
        }
      }
    }

  ]).toArray();

};

export const positions_over_time = async() : Promise<PositionsOverTime | null> => {

  if(error_if_needed('positions_over_time')){ return null; }

  const interval = crawl_interval_ms();

  //span is taken from the data, not from the clock, a database that only has
  //two minutes of history should not be drawn across two months of empty axis
  const oldest = await db!.collection('hashes')
    .find({}, { sort : { recorded_at : 1 }, limit : 1, projection : { recorded_at : 1 } })
    .toArray();

  const earliest = oldest[0]?.recorded_at;

  const span = earliest instanceof Date
    ? Math.max(interval, Date.now() - earliest.getTime())
    : interval;

  const { bucket_ms, count, since } = bucket_window(span, interval);

  //mongo buckets on floor(epochMs / width) and those boundaries are anchored to
  //the unix epoch, so the grid has to be anchored there too or every single
  //lookup key misses and every series reads zero
  const first = Math.floor(since / bucket_ms) * bucket_ms;

  const raw = await bucket_hashes(bucket_ms, new Date(first));

  const profiles = await get_profiles();

  //driven by the profile list, a deleted profile must not leave an orphan line
  const ordered = [ ...profiles ].sort((a, b) => a.id - b.id);

  const starts = Array.from({ length : count }, (_ignored, at) => first + at * bucket_ms);

  const series : ProfileSeries[] = ordered.map((profile) => {

    const mine = raw.filter((row) => row._id.profile_id === profile.id);
    const running = new Map<number, number>(
      mine.map((row) => [ row._id.bucket, row.running_total ])
    );

    //dense, every bucket carries the previous total forward so the line is
    //continuous and a profile with no findings still shows a flat zero
    let carried = 0;
    const points = starts.map((start) => {
      const total = running.get(Math.floor(start / bucket_ms));
      if(total !== undefined){ carried = total; }
      return { at : new Date(start).toISOString(), total : carried };
    });

    return { profile_id : profile.id, profile_name : profile.name, points };

  });

  return {
    bucket_ms,
    crawl_interval_ms : interval,
    generated_at : new Date().toISOString(),
    series
  };

};

//only the smoke tests empty collections, nothing in the app ever deletes.
//this refuses to run against the real database no matter who calls it, so a
//test can never be the reason a profile is lost
const clear = async( collection : string ) : Promise<void> => {
  if(error_if_needed('clear')){ return; }
  if(active_db_name === APP_DB){
    console.error(
      `[REFUSED] clear('${collection}') would empty ${APP_DB}, ` +
      `call init_test_db() instead`
    );
    return;
  }
  await db!.collection(collection).deleteMany({});
};

export const clear_hashes = async() : Promise<void> => { await clear('hashes'); };
export const clear_positions = async() : Promise<void> => { await clear('positions'); };
export const clear_profiles = async() : Promise<void> => { await clear('profiles'); };
export const clear_dork_holds = async() : Promise<void> => { await clear('dork_holds'); };

//only the smoke test writes these directly, the app only ever goes through
//remember_hash which is the one that dedupes
export const seed_hashes = async( docs : SeenHash[] ) : Promise<void> => {
  if(error_if_needed('seed_hashes')){ return; }
  await db!.collection('hashes').insertMany(docs);
};

