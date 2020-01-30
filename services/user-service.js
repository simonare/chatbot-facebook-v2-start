'use strict';

const request = require('request');
const config = require('../config');
const pg = require('pg');

pg.defaults.ssl = true;

module.exports = {
    addUser: function(callback, senderID){
        request({
            uri: 'https://graph.facebook.com/v5.0/' + senderID,
            qs: {
                access_token: config.FB_PAGE_TOKEN
            }
        }, async function(error, response, body){
            if (!error && response.statusCode == 200){
                var user = JSON.parse(body);
                console.log('getUserData:', user);
                if (user.first_name){
                    console.log("FB user: %s %s %s %s %s %s", user.first_name, user.last_name, user.profile_pic, user.locale, user.timezone, user.gender);
                    await storeUserData(senderID, user);
                    callback(user);
                }
                else{
                    console.log("Cannot get data for fb user with user id", senderID);
                }
            }
            else{
                console.error(response.error);
            }
        });
    },
    readAllUsers: function(callback, newstype) {
        var pool = new pg.Pool(config.PG_CONFIG);
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT fb_id, first_name, last_name FROM users WHERE newsletter=$1',
                    [newstype],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback([]);
                        } else {
                            console.log('rows');
                            console.log(result.rows);
                            callback(result.rows);
                        }
                    });
            //done();
        });
        pool.end();
    },

    newsletterSettings: function(callback, setting, userId) {
        var pool = new pg.Pool(config.PG_CONFIG);
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'UPDATE users SET newsletter=$1 WHERE fb_id=$2',
                    [setting, userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback(false);
                        } else {
                            callback(true);
                        }
                    });
            //done();
        });
        pool.end();
    }
};


async function storeUserData(senderId, user) {
    var pool = new pg.Pool(config.PG_CONFIG);
    pool.connect(function (error, client, done) {
        if (error)
            return console.error("Error acquiring client", error.stack);

        client.query(`SELECT fb_id FROM users WHERE fb_id = '${senderId}' LIMIT 1`,
            function (error, result) {
                if (error)
                    console.error("Query error: " + error);
                else {
                    if (result.rows.length === 0) {
                        let sql = "INSERT INTO users (fb_id, first_name, last_name, profile_pic, locale, timezone, gender) values ($1, $2, $3, $4, $5, $6, $7)";
                        client.query(sql, [
                            senderId,
                            user.first_name,
                            user.last_name,
                            user.profile_pic,
                            user.locale,
                            user.timezone,
                            user.gender
                        ]);
                    }
                }
            });
    });
    pool.end();
}