'use strict';

const request = require('request');
const config = require('./config');
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
                    console.log("FB user: %s %s %s", user.first_name, user.last_name, user.profile_pic);
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
                        let sql = "INSERT INTO users (fb_id, first_name, last_name, profile_pic) values ($1, $2, $3, $4)";
                        client.query(sql, [
                            senderId,
                            user.first_name,
                            user.last_name,
                            user.profile_pic
                        ]);
                    }
                }
            });
    });
    pool.end();
}