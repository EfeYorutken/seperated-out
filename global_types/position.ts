export type JobInformation = {
  job_title : string;
  //a crawl cannot know this, it stays null until a profile extracts it
  date_of_publish : string | null;
  description : string;//literally what the job needs you to do
  which_platform_was_it_found_on : string;
  company : string | null;//company name
  location : string | null;//ankara, istanbul, the continent of mu etc
};

export type Position = {

  /*
   * mongo hands this out on insert, build_position cannot know it, so it is
   * filled in by get_positions and stays absent on a position that was never
   * read back from the database
   */
  id? : string;

  generic_information : JobInformation;
  //which profile found this
  found_by : string;//name of the finding profile
  application_link : string; //click here to apply

};
