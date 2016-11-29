
import Command from "./Command";
import Container from "./Container";
import * as Bluebird from "bluebird";
import * as request from "request";

const AdmZip = require("adm-zip");
const fs = require("fs");
const execSync = require('child_process').execSync;
const FEED_URL = "http://gtfs.gbrail.info/gtfs.zip";
const ATOC_GTFS_PATH = "/tmp/atoc-gtfs/";
const ATOC_GTFS_FILENAME = ATOC_GTFS_PATH + "atoc-gtfs.zip";
const GTFS_SCHEMA = __dirname + "/../../asset/gtfs-schema.sql";

export default class ImportTimetable implements Command {
    private db;
    private logger;

    constructor(container: Container) {
        this.db = container.get("database");
        this.logger = container.get("logger");
    }

    async run(argv: string[]) {
        const schemaPromise = this.createSchema();

        this.logger("Prepping directory");
        this.createDownloadFolder();

        this.logger("Downloading GTFS feed");
        const stream = request(FEED_URL).pipe(fs.createWriteStream(ATOC_GTFS_FILENAME));
        await streamToPromise(stream);

        this.logger("Extracting feed");
        new AdmZip(ATOC_GTFS_FILENAME).extractAllTo(ATOC_GTFS_PATH);

        await schemaPromise;

        this.logger("Importing flat files");
        await Promise.all(this.importFiles());
    }

    private createSchema(): Promise<any> {
        return this.db.query(fs.readFileSync(GTFS_SCHEMA, "utf-8"));
    }

    private createDownloadFolder(): void {
        if (fs.existsSync(ATOC_GTFS_PATH)){
            execSync("rm -rf " + ATOC_GTFS_PATH);
        }

        fs.mkdirSync(ATOC_GTFS_PATH);
    }

    private importFiles(): Promise<any>[] {
        const fileHeadings = {
            "agency": "(agency_id,agency_name,agency_url,agency_timezone,agency_lang,agency_phone)",
            "calendar": "(service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,@date) SET end_date= STR_TO_DATE(@date,'%Y%m%d')",
            "routes": "(route_id,agency_id,route_short_name,route_long_name,route_type)",
            "stops": "(stop_id,stop_code,stop_name,stop_lat,stop_lon,stop_url,location_type,parent_station,wheelchair_boarding,cate_type,tiploc)",
            "stop_times": "(trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type,wtt_arrival_time,wtt_departure_time,platform,line,path,activity,engineering_allowance,pathing_allowance,performance_allowance)",
            "trips": "(route_id,service_id,trip_id,wheelchair_accessible,bikes_allowed,train_uid,train_status,train_category,train_identity,headcode,train_service_code,portion_id,power_type,timing_load,speed,oper_chars,train_class,sleepers,reservations,catering,service_branding,stp_indicator,uic_code,atoc_code,applicable_timetable)",
            "links": "(mode,from_stop_id,to_stop_id,link_secs,start_time,end_time,priority,start_date,end_date,monday,tuesday,wednesday,thursday,friday,saturday,sunday)",
            "feed_info": "(feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date)",
            "transfers": "(from_stop_id,to_stop_id,transfer_type,min_transfer_time)"
        };

        return Object.keys(fileHeadings).map((file) => {
           return this.db.query(`LOAD DATA LOCAL INFILE '${ATOC_GTFS_PATH}/${file}.txt' INTO TABLE ${file} FIELDS TERMINATED BY ',' IGNORE 1 LINES ${fileHeadings[file]}`);
        });
    }
}

function streamToPromise(stream) {
    return new Bluebird(function(resolve, reject) {
        stream.on("end", resolve);
        stream.on("finish", resolve);
        stream.on("error", reject);
    });
}