'use strict';

const request = require('request');
const config = require('./config');
const pg = require('pg');

pg.defaults.ssl = true;


module.exports = {
    readAllColors: function(callback){
        var pool = new pg.Pool(config.PG_CONFIG);
        pool.connect(function (error, client, done) {
            if (error)
                return console.error("Error acquiring client", error.stack);
    
            client.query(`SELECT color FROM public.iphone_colors`,
                function (error, result) {
                    if (error){
                        console.error("Query error: " + error);
                        callback([]);
                    }
                    else {
                        let colors = [];
                        for (let i = 0; i< result.rows.length; i++)
                            colors.push(result.rows[i]['color']);

                        callback(colors);
                    }
                });
        });
        pool.end();
    }
}