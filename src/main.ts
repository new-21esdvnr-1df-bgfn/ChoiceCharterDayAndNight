/// <reference types="@workadventure/iframe-api-typings" />


//import {parseCronExpression} from "cron-schedule";
//import {TimerBasedCronScheduler as scheduler} from "cron-schedule/schedulers/timer-based.js";

console.log('Script started successfully');



// Waiting for the API to be ready
WA.onInit().then(() => {
    console.log('Scripting API ready');

    // Julia custom

    // At 19:00, turn on night
    //const cronStartNight = parseCronExpression('0 19 * * *');
    //scheduler.setInterval(cronStartNight, () => {
        //WA.room.showLayer("night");
        //WA.room.showLayer("light");
    //});

    // At 7:00, turn on day
    //const cronStartDay = parseCronExpression('0 7 * * *');
    //scheduler.setInterval(cronStartDay, () => {
        //WA.room.hideLayer("night");
        //WA.room.hideLayer("light");
    //});

    // If the player enters the room between 19:00 and 7:00, turn on night
    //const date = new Date();
    //const startNight = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 19, 0, 0);
    //const startDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 7, 0, 0);
    //console.log(startDay)
    //console.log(startNight)
    //console.log(date)
    //console.log(date < startNight)
    //console.log(date > startDay)
    //console.log(date < startNight && date > startDay)
    //if (date < startNight && date > startDay) {
        
        //WA.room.hideLayer("night");
        //WA.room.hideLayer("light");
        
    //}

    // Julia custom
    WA.room.onEnterLayer("rooms_floor").subscribe(() => {
        WA.room.hideLayer("facade");
      });
      
    WA.room.onLeaveLayer("rooms_floor").subscribe(() => {
        WA.room.showLayer("facade");
      });


    }).catch(e => console.error(e));


export {};
