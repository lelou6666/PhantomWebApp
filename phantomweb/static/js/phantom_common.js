var ALERT_FADE_TIME_IN_MS = 10000;

// Shim for IE
if(!Array.prototype.indexOf) {
    Array.prototype.indexOf = function(needle) {
        for(var i = 0; i < this.length; i++) {
            if(this[i] === needle) {
                return i;
            }
        }
        return -1;
    };
}

function phantom_log(message) {

    if (typeof Exceptional !== 'undefined') {
        var line = 0; //TODO: get the line number from the stack?
        Exceptional.handle(message, document.URL, line);
    };
    console.log(message);
}

String.prototype.toProperCase = function () {
    return this.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});
};

function remove_element_after_delay(element, milliseconds) {
    window.setTimeout(function() {
        try {
            element.fadeOut(200, function() {
                $(this).remove();
            });
        }
        catch(e) {
            console.log(e);
        }
    }, milliseconds);
}

function phantom_info(message_text, alert_type) {
    alert_type = typeof alert_type !== 'undefined' ? alert_type : "alert-info";
    var new_alert = '<div class="alert ' + alert_type + '"><button type="button" class="close" data-dismiss="alert">&times;</button>' + message_text + '</div>'
    $("#alert-container").append(new_alert);
    remove_element_after_delay($("#alert-container .alert").last(), ALERT_FADE_TIME_IN_MS);
}

function phantom_alert(alert_text) {
    phantom_info(alert_text, "alert-error");
    phantom_log(alert_text);
}

function phantom_warning(alert_text) {
    phantom_info(alert_text, "");
}

function clear_phantom_alerts() {
    $("#alert-container").empty();
}

function make_url(p) {
    var base_url = document.location.href.concat("/");

    var first_slash = base_url.indexOf("/", 8);
    base_url = base_url.substring(0, first_slash);
    return base_url.concat('/api/dev/').concat(p);
}

function std_error_handler(url, error_msg) {
    var errorOpt = document.getElementById('error_status_text');
    errorOpt.innerText = error_msg;
    alert(error_msg);
    disable_buttons(false, "Ready.")
}

function load_error_handler(url, error_msg) {
    var errorOpt = document.getElementById('error_status_text');
    errorOpt.innerText = error_msg;
    $("#loading_image_div").hide();

    error_msg = error_msg.concat(".  Please refresh later.")
    $("#error_status_text").html(error_msg);
}


function phantomGET(url, func, error_func) {
    $.ajaxSetup({ cache: false });
    var xhr = $.ajax({
        type : "GET",
        url : url,
        dataType : "json",
        headers: {'X-CSRFToken': csrf_token},
        cache: false,
        success: function(data) {
            try {
                var obj = data;
                if(obj.error_message != undefined) {
                    var error_msg = obj.error_message;
                    if (error_func) {
                        error_func(url, error_msg);
                    }
                }
                else {
                    if (func) {
                        func(obj);
                    }
                }
            }
            catch(err) {
                alert(err);
            }
        },
        error : function(request, status, error) {
            try {
                var error_msg = "Error communicating with the service ".concat(request.statusText);
                if (error_func) {
                    error_func(url, error_msg);
                }
            }
            catch(err) {
                alert(err);
            }
        }
    });
    return xhr;
}

function phantomDELETE(url, func, error_func) {
    $.ajaxSetup({ cache: false });
    var xhr = $.ajax({
        type : "DELETE",
        url : url,
        headers: {'X-CSRFToken': csrf_token},
        cache: false,
        complete: function(xhr, status) {
            if (status === "success") {
                func()
            }
            else {
                try {
                    var error_msg = "Error communicating with the service (code " + status + "): ".concat(xhr.statusText);
                    error_func(url, error_msg);
                }
                catch(err) {
                    alert(err);
                }
            }
        }
    });
    return xhr;
}

function phantomPUT(url, data_vals, func, error_func) {

    var success_func = function (success_data){
        try {
            var obj = success_data;
            if(obj.error_message != undefined) {
                var error_msg = obj.error_message;
                error_func(url, error_msg);
            }
            else {
                func(obj);
            }
        }
        catch(err) {
            alert(err);
        }
    };

    var l_error_func = function(request, status, error)  {

        if (request.responseText) {
            var error_msg = request.responseText;
        }
        else {
            var error_msg = "Error communicating with the service ".concat(request.statusText);
        }
        error_func(url, error_msg);
    };

    $.ajaxSetup({ cache: false });
    var xhr = $.ajax({
        cache: false,
        type : "PUT",
        url : url,
        dataType : "json",
        headers: {'X-CSRFToken': csrf_token},
        data: JSON.stringify(data_vals),
        success: success_func,
        error: l_error_func
    });
    return xhr;
}

function phantomPOST(url, data_vals, func, error_func) {

    var success_func = function (success_data){
        try {
            var obj = success_data;
            if (obj.error_message != undefined) {
                var error_msg = obj.error_message;
                if (error_func) {
                    error_func(url, error_msg);
                }
            }
            else {
                if (func) {
                    func(obj);
                }
            }
        }
        catch(err) {
            alert(err);
        }
    };

    var l_error_func = function(request, status, error)  {

        if (request.responseText) {
            var error_msg = request.responseText;
        }
        else {
            var error_msg = "Error communicating with the service ".concat(request.statusText);
        }
        console.log(error_msg);
        if (error_func) {
            error_func(url, error_msg);
        }
    };

    $.ajaxSetup({ cache: false });
    var xhr = $.ajax({
        cache: false,
        type : "POST",
        url : url,
        dataType : "json",
        headers: {'X-CSRFToken': csrf_token},
        data: JSON.stringify(data_vals),
        success: success_func,
        error: l_error_func
    });
    return xhr;
}
