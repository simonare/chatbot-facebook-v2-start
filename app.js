'use strict';

//const dialogflow = require('dialogflow');
const config = require('./config');
const express = require('express');
//const crypto = require('crypto');
const bodyParser = require('body-parser');
//const request = require('request');
const app = express();
const uuid = require('uuid');
const pg = require('pg');

pg.defaults.ssl = true;

const userService = require('./services/user-service');
const colors = require('./colors');
const weatherService = require('./services/weather-service');
const jobApplicationService = require('./services/job-application-service');
let dialogflowService = require('./services/dialogflow-service');
const fbService = require('./services/fb-service');
const broadcast = require('./routes/broadcast');

const passport = require("passport");
const FacebookStrategy = require("passport-facebook").Strategy;
const session = require("express-session");

// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
    throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
    throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.GOOGLE_PROJECT_ID) {
    throw new Error('missing GOOGLE_PROJECT_ID');
}
if (!config.DF_LANGUAGE_CODE) {
    throw new Error('missing DF_LANGUAGE_CODE');
}
if (!config.GOOGLE_CLIENT_EMAIL) {
    throw new Error('missing GOOGLE_CLIENT_EMAIL');
}
if (!config.GOOGLE_PRIVATE_KEY) {
    throw new Error('missing GOOGLE_PRIVATE_KEY');
}
if (!config.FB_APP_SECRET) {
    throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
    throw new Error('missing SERVER_URL');
}
if (!config.SENDGRID_API_KEY) {
    throw new Error('missing SENDGRID_API_KEY');
}
if (!config.EMAIL_FROM) {
    throw new Error('missing EMAIL_FROM');
}
if (!config.EMAIL_TO) {
    throw new Error('missing EMAIL_TO');
}
if (!config.WEATHER_API_KEY) {
    throw new Error('missing WEATHER_API_KEY');
}
if (!config.PG_CONFIG) {
    throw new Error('missing PG_CONFIG');
}
if (!config.ADMIN_ID){
    throw new Error('missing ADMIN_ID');
}

app.set('port', (process.env.PORT || 5000));

//verify request came from facebook
app.use(bodyParser.json({
    verify: fbService.verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));
//app.use('/js', express.static(__dirname + '/node_modules/bootstrap/dist/js')); // redirect bootstrap JS
//app.use('/css', express.static(__dirname + '/node_modules/bootstrap/dist/css')); // redirect CSS bootstrap
app.use('/js', express.static(__dirname + '/node_modules/jquery/dist'));
app.use('/js', express.static(__dirname + '/node_modules/popper.js/dist/umd'));
app.use(express.static(__dirname + '/node_modules/bootstrap/dist'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
    extended: false
}));

// Process application/json
app.use(bodyParser.json());

app.use(session({
    secret: 'Datamax2005tfT',
    resave: true,
    saveUninitialized: true
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser(function (profile, cb) {
    cb(null, profile);
});
passport.deserializeUser(function (profile, cb) {
    cb(null, profile);
});

passport.use(new FacebookStrategy({
    clientID: config.FB_APP_ID,
    clientSecret: config.FB_APP_SECRET,
    callbackURL: config.SERVER_URL + 'auth/facebook/callback'
},     function(accessToken, refreshToken, profile, cb) {
    process.nextTick(function() {
        return cb(null, profile);
    });
}));

app.get('/auth/facebook', passport.authenticate('facebook', { scope: 'public_profile' }));
app.get('/auth/facebook/callback', passport.authenticate('facebook', { successRedirect: '/broadcast/broadcast', failureRedirect: '/broadcast' }));

app.set('view engine', 'ejs');

// const credentials = {
//     client_email: config.GOOGLE_CLIENT_EMAIL,
//     private_key: config.GOOGLE_PRIVATE_KEY,
// };

// const sessionClient = new dialogflow.SessionsClient(
//     {
//         projectId: config.GOOGLE_PROJECT_ID,
//         credentials
//     }
// );


const sessionIds = new Map();
const usersMap = new Map();

// Index route
app.get('/', function (req, res) {
    res.send('Hello world, I am a chat bot');
});


app.use('/broadcast', broadcast);

// for Facebook verification
app.get('/webhook/', function (req, res) {
    console.log("request");
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);
    }
});

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
    var data = req.body;
    console.log(JSON.stringify(data));



    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function (pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function (messagingEvent) {
                if (messagingEvent.optin) {
                    fbService.receivedAuthentication(messagingEvent);
                } else if (messagingEvent.message) {
                    receivedMessage(messagingEvent);
                } else if (messagingEvent.delivery) {
                    fbService.receivedDeliveryConfirmation(messagingEvent);
                } else if (messagingEvent.postback) {
                    receivedPostback(messagingEvent);
                } else if (messagingEvent.read) {
                    fbService.receivedMessageRead(messagingEvent);
                } else if (messagingEvent.account_linking) {
                    fbService.receivedAccountLink(messagingEvent);
                } else {
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });

        // Assume all went well.
        // You must send back a 200, within 20 seconds
        res.sendStatus(200);
    }
});


async function setSessionAndUser(senderID) {
    if (!sessionIds.has(senderID)) {
        console.log("Adding senderId '%s' to 'sessionIds'", senderID);
        sessionIds.set(senderID, uuid.v1());
    }

    if (!usersMap.has(senderID)) {
        userService.addUser(function (user) {
            console.log("Adding senderId '%s' to 'usersMap' with user data", senderID, user);
            usersMap.set(senderID, user);
        }, senderID);
    }
}


function receivedMessage(event) {

    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    setSessionAndUser(senderID);

    console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
    console.log(JSON.stringify(message));

    var isEcho = message.is_echo;
    var messageId = message.mid;
    var appId = message.app_id;
    var metadata = message.metadata;

    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;
    var quickReply = message.quick_reply;

    if (isEcho) {
        fbService.handleEcho(messageId, appId, metadata);
        return;
    } else if (quickReply) {
        handleQuickReply(senderID, quickReply, messageId);
        return;
    }


    if (messageText) {
        //send message to DialogFlow
        dialogflowService.sendTextQueryToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, messageText);
    } else if (messageAttachments) {
        fbService.handleMessageAttachments(messageAttachments, senderID);
    }
}

function handleQuickReply(senderID, quickReply, messageId) {
    var quickReplyPayload = quickReply.payload;
    switch (quickReplyPayload) {
        case 'NEWS_PER_WEEK':
            userService.newsletterSettings(function (updated) {
                if (updated) {
                    fbService.sendTextMessage(senderID, "Yeniliklerimize üye olduğunuz için teşekkürler! Üyelikten çıkmak için 'Üyelikten Ayrıl' yazmanız yeterli olacaktır");
                } else {
                    fbService.sendTextMessage(senderID, "Haberler şuan için tarafınıza iletilemiyor. Lütfen daha sonra tekrar deneyiniz!");
                }
            }, 1, senderID);
            break;
        case 'NEWS_PER_DAY':
            userService.newsletterSettings(function (updated) {
                if (updated) {
                    fbService.sendTextMessage(senderID, "Yeniliklerimize üye olduğunuz için teşekkürler! Üyelikten çıkmak için 'Üyelikten Ayrıl' yazmanız yeterli olacaktır");
                } else {
                    fbService.sendTextMessage(senderID, "Haberler şuan için tarafınıza iletilemiyor. Lütfen daha sonra tekrar deneyiniz!");
                }
            }, 2, senderID);
            break;
        default:
            dialogflowService.sendTextQueryToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, quickReplyPayload);
            break;
    }
}

function handleDialogFlowAction(sender, action, messages, contexts, parameters) {
    switch (action) {
        case "unsubscribe":
            userService.newsletterSettings(function (updated) {
                if (updated) {
                    fbService.sendTextMessage(sender, "Haber üyeliğimizden ayrıldığınıza üzüldük. Fakat ne zaman isterseniz yeniden üye olabileceğinizi unutmayın! Sizi aramızda görmekten memnuniyet duyarız.");
                } else {
                    fbService.sendTextMessage(sender, "Haberler şuan için tarafınıza iletilemiyor. Lütfen daha sonra tekrar deneyiniz!");
                }
            }, 0, sender);
            break;
        case "buy.iphone":
            colors.readUserColor(function (color) {
                let reply;
                if (color == '') {
                    reply = "Telefonunuzu hangi renkte almak istersiniz?";
                }
                else {
                    reply = `Telefonunuz favori renginiz ${color} olarak göndermemizi ister misiniz?`;
                }
                fbService.sendTextMessage(sender, reply);
            }, sender);
            break;
        case "iphone_colors.favourite":
            colors.updateUserColor(parameters.fields['color'].stringValue, sender);
            fbService.sendTextMessage(sender, "Bu rengi ben de seviyorum. Tercihini hatırlayacağım.");
            break;
        case "iphone_colors":
            colors.readAllColors(function (allColors) {
                let allColorsString = allColors.join(', ');
                let reply = `IPhone xxx ${allColorsString} reklerinde mevcuttur. Sizin favori renginiz ne?`;
                fbService.sendTextMessage(sender, reply);
            });
            break;
        case "get-current-weather":
            console.log("Getting weather information for ", parameters.fields["geo-city"]);

            weatherService(function (weatherSummary) {
                if (!weatherSummary) {
                    fbService.sendTextMessage(sender, "Üzgünüm, şuan hava durumu ile ilgili bilgim yok.");
                    return;
                }

                if (Object.prototype.hasOwnProperty.call(weatherSummary, "main")) {
                    fbService.sendTextMessage(sender, `${messages[0].text.text} ${weatherSummary.desc}`);
                    fbService.sendTextMessage(sender, `Şuan hava ${weatherSummary.temp} °C. En yüksek hava sıcaklığı ${weatherSummary.temp_max} °C, en düşük hava sıcaklığı ise ${weatherSummary.temp_min} &#8451`);
                }
                else {
                    fbService.sendTextMessage(`Şuan ${parameters.fields["geo-city"].stringValue} için hava durumu mevcut değil!`);
                }

            }, parameters.fields['geo-city'].stringValue);
            break;
        case "faq-delivery":
            fbService.handleMessages(messages, sender);

            fbService.sendTypingOn(sender);

            setTimeout(function () {
                let buttons = [
                    {
                        type: "web_url",
                        url: "https://www.google.com.tr",
                        title: "Track your order"
                    },
                    {
                        type: "phone_number",
                        title: "Call Us!",
                        payload: "+905428770938"
                    },
                    {
                        type: "postback",
                        title: "Keep on Chatting",
                        payload: "CHAT"
                    },

                ];

                fbService.sendButtonMessage(sender, "What would you like to do next?", buttons);
            }, 3000);

            break;
        case "detailed-application":{
            let filteredContexts = contexts.filter(function (el) {
                return el.name.includes('job_application') ||
                    el.name.includes('job-application-details_dialog_context');
            });

            //console.log("detailed-application");
            //console.log(filteredContexts[0].parameters);

            if (filteredContexts.length > 0 && contexts[0].parameters) {
                let phone_number = (fbService.isDefined(contexts[0].parameters.fields['phone-number']) && contexts[0].parameters.fields['phone-number'] != '') ?
                    contexts[0].parameters.fields['phone-number'].stringValue : '';
                let user_name = (fbService.isDefined(contexts[0].parameters.fields['user-name']) && contexts[0].parameters.fields['user-name'] != '') ?
                    contexts[0].parameters.fields['user-name'].stringValue : '';
                let previous_job = (fbService.isDefined(contexts[0].parameters.fields['previous-job']) && contexts[0].parameters.fields['previous-job'] != '') ?
                    contexts[0].parameters.fields['previous-job'].stringValue : '';
                let years_of_exp = (fbService.isDefined(contexts[0].parameters.fields['years-of-experience']) && contexts[0].parameters.fields['years-of-experience'] != '') ?
                    contexts[0].parameters.fields['years-of-experience'].stringValue : '';
                let job_vacancy = (fbService.isDefined(contexts[0].parameters.fields['job-vacancy']) && contexts[0].parameters.fields['job-vacancy'] != '') ?
                    contexts[0].parameters.fields['job-vacancy'].stringValue : '';


                if (phone_number == '' && user_name != '' && previous_job != '' && years_of_exp == '') {
                    let replies = [
                        {
                            content_type: "text",
                            title: "2 Yıldan az",
                            payload: "Less_than_2year"
                        },
                        {
                            content_type: "text",
                            title: "10 Yıldan az",
                            payload: "Less_than_10year"
                        },
                        {
                            content_type: "text",
                            title: "10 Yıldan fazla",
                            payload: "More_than_10year"
                        }
                    ];
                    fbService.sendQuickReply(sender, messages[0].text.text[0], replies);
                }
                else if (phone_number != '' && user_name != '' && previous_job != '' && years_of_exp != '' && job_vacancy != '') {
                    jobApplicationService(phone_number, user_name, previous_job, years_of_exp, job_vacancy);

                    fbService.handleMessages(messages, sender);
                } else {
                    fbService.handleMessages(messages, sender);
                }
            }
            break;
        }
        default:
            //unhandled action, just send back the text
            fbService.handleMessages(messages, sender);
    }
}

// function handleMessage(message, sender) {
//     switch (message.message) {
//         case "text": //text
//             message.text.text.forEach((text) => {
//                 if (text !== '') {
//                     sendTextMessage(sender, text);
//                 }
//             });
//             break;
//         case "quickReplies": //quick replies
//             let replies = [];
//             message.quickReplies.quickReplies.forEach((text) => {
//                 let reply =
//                     {
//                         "content_type": "text",
//                         "title": text,
//                         "payload": text
//                     }
//                 replies.push(reply);
//             });
//             sendQuickReply(sender, message.quickReplies.title, replies);
//             break;
//         case "image": //image
//             sendImageMessage(sender, message.image.imageUri);
//             break;
//     }
// }


// function handleCardMessages(messages, sender) {

//     let elements = [];
//     for (var m = 0; m < messages.length; m++) {
//         let message = messages[m];
//         let buttons = [];
//         for (var b = 0; b < message.card.buttons.length; b++) {
//             let isLink = (message.card.buttons[b].postback.substring(0, 4) === 'http');
//             let button;
//             if (isLink) {
//                 button = {
//                     "type": "web_url",
//                     "title": message.card.buttons[b].text,
//                     "url": message.card.buttons[b].postback
//                 }
//             } else {
//                 button = {
//                     "type": "postback",
//                     "title": message.card.buttons[b].text,
//                     "payload": message.card.buttons[b].postback
//                 }
//             }
//             buttons.push(button);
//         }


//         let element = {
//             "title": message.card.title,
//             "image_url":message.card.imageUri,
//             "subtitle": message.card.subtitle,
//             "buttons": buttons
//         };
//         elements.push(element);
//     }
//     sendGenericMessage(sender, elements);
// }


// function handleMessages(messages, sender) {
//     let timeoutInterval = 1100;
//     let previousType ;
//     let cardTypes = [];
//     let timeout = 0;
//     for (var i = 0; i < messages.length; i++) {

//         if ( previousType == "card" && (messages[i].message != "card" || i == messages.length - 1)) {
//             timeout = (i - 1) * timeoutInterval;
//             setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
//             cardTypes = [];
//             timeout = i * timeoutInterval;
//             setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
//         } else if ( messages[i].message == "card" && i == messages.length - 1) {
//             cardTypes.push(messages[i]);
//             timeout = (i - 1) * timeoutInterval;
//             setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
//             cardTypes = [];
//         } else if ( messages[i].message == "card") {
//             cardTypes.push(messages[i]);
//         } else  {

//             timeout = i * timeoutInterval;
//             setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
//         }

//         previousType = messages[i].message;

//     }
// }

function handleDialogFlowResponse(sender, response) {
    let responseText = response.fulfillmentMessages.fulfillmentText;

    let messages = response.fulfillmentMessages;
    let action = response.action;
    let contexts = response.outputContexts;
    let parameters = response.parameters;

    fbService.sendTypingOff(sender);

    if (fbService.isDefined(action)) {
        handleDialogFlowAction(sender, action, messages, contexts, parameters);
    } else if (fbService.isDefined(messages)) {
        fbService.handleMessages(messages, sender);
    } else if (responseText == '' && !fbService.isDefined(action)) {
        //dialogflow could not evaluate input.
        fbService.sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
    } else if (fbService.isDefined(responseText)) {
        fbService.sendTextMessage(sender, responseText);
    }
}


// function sendTextMessage(recipientId, text) {
//     var messageData = {
//         recipient: {
//             id: recipientId
//         },
//         message: {
//             text: text
//         }
//     }
//     callSendAPI(messageData);
// }

// /*
//  * Call the Send API. The message data goes in the body. If successful, we'll
//  * get the message id in a response
//  *
//  */
// function callSendAPI(messageData) {
//     request({
//         uri: 'https://graph.facebook.com/v3.2/me/messages',
//         qs: {
//             access_token: config.FB_PAGE_TOKEN
//         },
//         method: 'POST',
//         json: messageData

//     }, function (error, response, body) {
//         if (!error && response.statusCode == 200) {
//             var recipientId = body.recipient_id;
//             var messageId = body.message_id;

//             if (messageId) {
//                 console.log("Successfully sent message with id %s to recipient %s",
//                     messageId, recipientId);
//             } else {
//                 console.log("Successfully called Send API for recipient %s",
//                     recipientId);
//             }
//         } else {
//             console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
//         }
//     });
// }



/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    setSessionAndUser(senderID);

    // The 'payload' param is a developer-defined field which is set in a postback
    // button for Structured Messages.
    var payload = event.postback.payload;

    switch (payload) {
        case "FUN_NEWS":
            sendFunNewsSubscribe(senderID);
            break;
        case "GET_STARTED":
            greetUserText(senderID);
            break;
        case "JOB_APPLY":
            dialogflowService.sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, "JOB_OPENINGS");
            break;
        case "CHAT":
            fbService.sendTextMessage(senderID, "Ben de sohbetinizden keyif aldım. Bana sormak istediğiniz başka birşey var mı?");
            break;
        default:
            //unindentified payload
            fbService.sendTextMessage(senderID, "Neye ihtiyacınız olduğundan tam olarak emin olamadım. Daha açık belirtebilirmisiniz?");
            break;

    }

    console.log("Received postback for user %d and page %d with payload '%s' " +
        "at %d", senderID, recipientID, payload, timeOfPostback);

}

function sendFunNewsSubscribe(userId) {
    let responceText = "Size son teknoloji haberlerini gönderebilirim. " +
        "Biraz gülüp bilgi edinmeniz için güzel bir yol olduğunu düşünüyorum. Haberleri ne sıklıkla almak istiyorsunuz?";

    let replies = [
        {
            "content_type": "text",
            "title": "Haftada bir kez",
            "payload": "NEWS_PER_WEEK"
        },
        {
            "content_type": "text",
            "title": "Günde bir kez",
            "payload": "NEWS_PER_DAY"
        }
    ];

    fbService.sendQuickReply(userId, responceText, replies);
}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    // All messages before watermark (a timestamp) or sequence have been seen.
    var watermark = event.read.watermark;
    var sequenceNumber = event.read.seq;

    console.log("Received message read event for watermark %d and sequence " +
        "number %d", watermark, sequenceNumber);
}


// function sendEmail(subject, content) {
//     console.log("sending e-mail");
//     const sgMail = require("@sendgrid/mail");
//     sgMail.setApiKey(config.SENDGRID_API_KEY);
//     const msg = {
//         to: config.EMAIL_TO,
//         from: config.EMAIL_FROM,
//         subject: subject,
//         text: content,
//         html: content
//     };
//     sgMail.send(msg)
//         .then(() => console.log("email sent!"))
//         .catch(error => {
//             console.log("email not sent!");
//             console.log(error.toString());
//         });
// }

async function resolveAfterXSeconds(x) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(x);
        }, x * 1000);
    });
}

async function greetUserText(senderID) {
    let user = usersMap.get(senderID);

    if (!user) {
        await resolveAfterXSeconds(2);
        user = usersMap.get(senderID);
    }

    if (user) {
        fbService.sendTextMessage(senderID, "Merhaba " + user.first_name + '!' +
            'sizin için sıklıkla sorulan sorulara cevap verebilir veya açık pozisyonlarımız hakkında bilgi vererek iş başvurunuzu alabilirim.');
    }
    else {
        fbService.sendTextMessage(senderID, "Merhaba! " +
            'sizin için sıklıkla sorulan sorulara cevap verebilir veya açık pozisyonlarımız hakkında bilgi vererek iş başvurunuzu alabilirim.');
    }



}

function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}

// Spin up the server
app.listen(app.get('port'), function () {
    console.log('running on port', app.get('port'));
});
