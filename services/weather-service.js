'use strict';
const request = require('request');
const config = require('../config');


module.exports = function(callback, geoCity){
    
    const options = {
        url: 'https://api.openweathermap.org/data/2.5/weather',
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Accept-Charset': 'utf-8',
            'User-Agent': 'dk-chatbot-client'
        },
        qs: {
            appid: config.WEATHER_API_KEY,
            q: geoCity,
            lang: "tr",
            units: "metric"
        }
    };
    
    request(options, function(error, response, body){
        if(!error && response.statusCode == 200) {
            let weather = JSON.parse(body);
            if (Object.prototype.hasOwnProperty.call(weather, "weather")) {
                callback({
                    main: weather.weather[0].main,
                    desc: weather.weather[0].description,
                    temp: weather.main.temp,
                    temp_min: weather.main.temp_min,
                    temp_max: weather.main.temp_max,
                    dt: weather.dt
                });
            } else {
                console.error("Error on getting weather information with status code %s", response.statusCode);
                console.error("Error ", error, "Body", body);
                callback(null);
            }
        } else {
            callback(null);
            console.error(response.error);
        }
    });
};