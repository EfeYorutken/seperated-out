export enum Action {
  CLICK,
  TYPE
};

export type SELECTOR = string;

export type Profile = {

  id : number;
  //Profile name
  name : string;
  //the url from which this profile will start crawling
  crawling_start_url : string;
  //a mapping from what selector is to be looked at and what words need to
  //be looked for there
  //where_to_look_and_how : Map<SELECTOR, string[]>;
  where_to_look_and_how : {
    keywords : string[];
    selector : string;
  };
  //found positions, will be used for committing to db AND sifting through
  found_positions_url : string[];
  //steps that should be taken before the job posts are checked
  /*
   * for(activity : what_to_do_before_checking){
   *  crawler.execute(activity.at(0), activity.at(1))
   * }
   * for(page : crawler.current_page.clickables){
   * this.to_be_considered.add(page.url)
   * }
   */
  what_to_do_before_checking : [ {action : Action, selector: SELECTOR} ];
  platform_name : string; //the NAME of the platform that will be checked

};
