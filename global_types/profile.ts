export type Profile = {

  id : number;
  //Profile name
  name : string;
  /*
   * the domain the postings live on, without protocol or path, for example
   * 'www.myjobpage.com'. it feeds the site: part of the google dork and it is
   * what a found position is reported to have been found on
   */
  platform_domain : string;
  /*
   * a section of the url that separates a job post from any other kind of
   * page, for example '/open-positions/'. it feeds the inurl: part of the dork
   */
  url_section : string;
  /*
   * optional 'find jobs after <date>' as a yyyy-mm-dd string, feeds the
   * after: part of the dork. null or '' means no lower bound
   */
  publish_after : string | null;
  /*
   * the elements worth reading: what a middle click recorded. on every page
   * the dork hands back, each match is checked against description_selector
   * and the ones that hold all of them are read as postings
   */
  post_selector : string[];
  /*
   * the sections every posting holds: what a right click recorded. a post
   * only counts when it contains every one of these
   */
  description_selector : string[];
  //what the dork searches for, joined into (kw1 OR kw2) in the query
  keywords : string[];
  //what the dork discards, each one a -term exclusion in the query
  anti_keywords : string[];

};
