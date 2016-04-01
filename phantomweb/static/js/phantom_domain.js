// TODO: turn this into some kind of model object
var g_domain_data = {};
var g_launch_configs = {};
var g_chef_credentials = {};
var g_domain_details = {};
var g_domain_details_cache = {};
var g_decision_engines_by_name = {'Sensor': 'sensor', 'Multi Cloud': 'multicloud'};
var g_decision_engines_by_type = {'sensor': 'Sensor', 'multicloud': 'Multi Cloud'};
var g_current_details_request = null;
var g_current_details_timer = null;
var g_selected_domain = null;
var g_selected_instance = null;
var g_available_sensors = [];
var DEFAULT_DECISION_ENGINE = 'Multi Cloud';
var DETAILS_TIMER_MS = 5000;
var SENSOR_HINT_ITEMS = 200;

$(document).ready(function() {

    $("#nav-domains").addClass("active");

    $("#phantom_domain_main_combined_pane_inner").hide();
    $("#scaling_sensor_value").hide();
    $("#domain-metrics").hide();
    $("#phantom_domain_chef_choice").parent().parent().hide();

    var $sensor_input = $("#phantom_domain_sensors_input").tagsManager({
        typeahead: true,
        typeaheadDelegate: {
            source: function() {
                return g_available_sensors;
            },
            minLength: 0,
            items: SENSOR_HINT_ITEMS
        }
    });

    //enable showing hints on click
    if ($sensor_input.typeahead.bind) {
        $sensor_input.on('focus', $sensor_input.typeahead.bind($sensor_input, 'lookup'));
    }

    $("input[name=hidden-tags]").change(function() {
        phantom_update_sensors();
        return false;
    });

    $("#phantom_domain_lc_choice").change(function() {
        var lc_name = $("#phantom_domain_lc_choice").val();
        var lc = g_launch_configs[lc_name];
        if (lc && lc.contextualization_method === "chef") {
            $("#phantom_domain_chef_choice").parent().parent().show();
        }
        else {
            $("#phantom_domain_chef_choice").parent().parent().hide();
        }
    });


    $("body").click(function() {
        phantom_domain_noncontext_mouse_down();
    })

    $("#phantom_domain_update_button").click(function() {
        phantom_domain_update_click();
        return false;
    })

    $("#phantom_domain_filter_list").change(function() {
        phantom_domain_update_click();
    });

    $("#phantom_domain_de_choice").change(function() {
        phantom_select_de($("#phantom_domain_de_choice").val());
        return false;
    });

    $("#phantom_domain_button_add").click(function() {
        phantom_add_domain_click();
        return false;
    });

    $(document).on("click", "a.domain", function() {
        var domain = $(this).text();
        phantom_domain_select_domain(domain);
        return false;
    });

    $("#phantom_domain_list_domains option").click(function() {
        phantom_domain_select_domain();
        return false;
    });

    $("#phantom_domain_button_start").click(function() {
        phantom_domain_start_click();
        return false;
    });

    $("#phantom_domain_button_resize").click(function() {
        phantom_domain_resize_click();
        return false;
    });

    $("#phantom_domain_button_terminate").click(function() {
        phantom_domain_terminate_click();
        return false;
    });

    $("#details_table_body").on('click', 'tr', function(event){
        $(this).parent().children().removeClass("info");
        var instance_id = $(this).children().first().text();
        show_instance_details(instance_id);
    });

    $("#details_table_body").on('contextmenu', 'tr', function(event){
        var instance_id = $(this).children().first().text();
        var instance = get_instance(instance_id)
        if (instance === null) {
          return;
        }

        var domain = get_selected_domain();
        if (domain === null) {
          return;
        }

        phantom_domain_context_menu(event, domain.id, instance.id, instance.cloud);
        return false;
    });

    $("#details_button_replace_vm").click(function() {
        var instance_id = get_selected_instance_id();
        var instance = get_instance(instance_id);
        if (instance === null) {
          return;
        }

        var domain = get_selected_domain();
        if (domain === null) {
          return;
        }
        phantom_domain_instance_replace_click(domain.id, instance.id, instance.cloud);

        return false;
    });

    $("#details_button_terminate_vm").click(function() {
        var instance_id = get_selected_instance_id();
        var instance = get_instance(instance_id);
        if (instance === null) {
          return;
        }

        var domain = get_selected_domain();
        if (!domain) {
          return;
        }
        phantom_domain_instance_terminate_click(domain.id, instance.id, instance.cloud);

        return false;
    });

    get_available_sensors();

    $("#phantom_domain_de_choice").val(DEFAULT_DECISION_ENGINE);
    phantom_select_de(DEFAULT_DECISION_ENGINE);
    phantom_domain_load();
});


function phantom_domain_buttons(enabled) {

    if (enabled) {
        $("input, select").removeAttr("disabled");
        $("#phantom_domain_button_add").removeAttr("disabled")
            .parent().removeClass("disabled");
        $("#loading").hide();
    }
    else {
        $("input, select").attr("disabled", true);
        $("#phantom_domain_button_add").attr("disabled", true)
            .parent().addClass("disabled");
        $("#loading").show();
    }
}

function get_available_sensors(query, callback) {
    var success = function(sensors) {
        g_available_sensors = [];
        for(var i=0; i<sensors.length; i++) {
            var sensor = sensors[i];
            g_available_sensors.push(sensor.id);
        }
    }

    var failure = function(response) {
        console.log("Failure getting sensors");
    }

    var url = make_url('sensors')
    phantomGET(url, success, failure);
}


function phantom_domain_details_buttons(enabled) {

    if (enabled) {
        $('#phantom_details_loading_image').hide();
        $("#phantom_domain_details_filter_div > input, #phantom_domain_details_filter_div > select").removeAttr("disabled");
    }
    else {
        $("#phantom_domain_details_filter_div > input, #phantom_domain_details_filter_div > select").attr("disabled", true);
        $('#phantom_details_loading_image').show();
    }
}

function phantom_add_domain_click() {
    if ( $("#phantom_domain_button_add").attr("disabled") ) {
        return false;
    }
    var new_domain_name = prompt("Enter a new domain name:");
    if (new_domain_name === null) {
        return false;
    }
    if (g_domain_data.hasOwnProperty(new_domain_name)) {
        phantom_warning("You already have a domain called " + new_domain_name);
        return false;
    }
    g_domain_data[new_domain_name] = {};
    phantom_domain_load_domain_names();

    phantom_domain_deselect_domain();
    $("#phantom_domain_list_domains").val(new_domain_name);
    phantom_domain_select_domain(new_domain_name, false);
}

function phantom_update_sensors() {
    var metrics_raw = $("input[name=hidden-tags]").val();
    var metrics = metrics_raw.split(",");
    var old_selected_metric = $("#phantom_domain_metric_choice").val();

    $("#phantom_domain_metric_choice").empty();
    for (var i=0; i<metrics.length; i++) {
        var metric = metrics[i];

        $(".myTag span:contains('domain:')").parent().addClass("domain_sensor_tag");

        if (metric.lastIndexOf("domain:", 0) === 0) {
            var metric_cleaned = metric.split("domain:")[1];
            metric = metric_cleaned;
        }
        
        var new_opt = $('<option>', {'name': metric, value: metric, text: metric});
        $("#phantom_domain_metric_choice").append(new_opt);
    }
    $("#phantom_domain_metric_choice").val(old_selected_metric);
}

function phantom_domain_load_lc_names() {
    $("#phantom_domain_lc_choice").empty();

    for(var lc_name in g_launch_configs) {
        var new_opt = $('<option>', {'name': lc_name, value: lc_name, text: lc_name});
        $("#phantom_domain_lc_choice").append(new_opt);
    }
}

function phantom_domain_load_chef_names() {
    $("#phantom_domain_chef_choice").empty();

    for(var chef_name in g_chef_credentials) {
        var new_opt = $('<option>', {'name': chef_name, value: chef_name, text: chef_name});
        $("#phantom_domain_chef_choice").append(new_opt);
    }
}

function phantom_domain_load_domain_names() {
    var previously_selected_domain = $("#phantom_domain_list_domains").val();

    $("#domain-header").nextAll().remove();

    for(var domain_name in g_domain_data) {
        var new_domain = $('<li><a href="#" class="domain" id="domain-' + domain_name + '">' + domain_name + '</a></li>');
        $("#domain-nav").append(new_domain);
    }

    $("#phantom_domain_list_domains").val(previously_selected_domain);
}

function phantom_domain_load_de_names() {
    $("#phantom_domain_de_choice").empty();

    for(var decision_engine in g_decision_engines_by_name) {
        var new_opt = $('<option>', {'name': decision_engine, value: decision_engine, text: decision_engine});
        $("#phantom_domain_de_choice").append(new_opt);
    }
}

function phantom_select_de(decision_engine) {
    var current_de = $("#phantom_domain_de_choice").val();

    if (decision_engine === "Sensor") {
        $("#phantom_domain_de_choice").val("Sensor");
        $("#phantom_domain_sensor_preferences").show();
        $("#phantom_domain_multicloud_preferences").hide();
    }
    else if (decision_engine === "Multi Cloud") {
        $("#phantom_domain_de_choice").val("Multi Cloud");
        $("#phantom_domain_sensor_preferences").hide();
        $("#phantom_domain_multicloud_preferences").show();
    }
    else {
        console.log("Don't know de type: " + decision_engine);
    }
}

function phantom_domain_load_internal(select_domain_on_success) {

    select_domain_on_success = typeof select_domain_on_success !== 'undefined' ? select_domain_on_success : null;

    var load_lc_success_func = function(lcs) {
        g_launch_configs = {};
        for(var i=0; i<lcs.length; i++) {
            var lc = lcs[i];
            g_launch_configs[lc.name] = lc;
        }
    }

    var load_chef_credentials_success_func = function(creds) {
        g_chef_credentials = {};
        for(var i=0; i<creds.length; i++) {
            var cred = creds[i];
            g_chef_credentials[cred.id] = cred;
        }
    }

    var domain_success_func = function(domains) {
        g_domain_data = {};
        for(var i=0; i<domains.length; i++) {
            var domain = domains[i];
            g_domain_data[domain.name] = domain;
        }

        phantom_domain_load_domain_names();
        phantom_domain_buttons(true);
        if (g_selected_domain && select_domain_on_success) {
            phantom_domain_select_domain(g_selected_domain, select_domain_on_success);
        }
        else if (g_selected_domain === null) {
            var domain_name = $("a.domain").first().text();
            if (domain_name) {
                phantom_domain_select_domain(domain_name);
            }
        }

    };

    var error_func = function(obj, message) {
        phantom_alert(message);
        $('#loading').hide();
    }

    phantom_domain_buttons(false);

    var lc_url = make_url('launchconfigurations')
    var lc_request = phantomGET(lc_url);

    var chef_url = make_url('credentials/chef')
    var chef_request = phantomGET(chef_url)

    var domain_url = make_url('domains')
    var domain_request = phantomGET(domain_url);

    $.when(lc_request, chef_request, domain_request)
        .done(function(lc_response, chef_credentials_response, domains_response) {
            var lcs = lc_response[0];
            var chef_credentials = chef_credentials_response[0];
            var domains = domains_response[0];

            load_lc_success_func(lcs);
            load_chef_credentials_success_func(chef_credentials);
            domain_success_func(domains);
        })
        .fail(function(message) {
            phantom_alert("There was a problem loading your domains.  Please try again later. ".concat(message));
            $('#loading').hide();
        });
}

function phantom_domain_load() {
    try {
        phantom_domain_load_internal();
    }
    catch(err) {
        phantom_alert(err);
    }
}

function phantom_domain_start_click_internal() {
    var domain = gather_domain_params_from_ui();
    if (domain === null) {
        return;
    }

    var success_func = function(obj) {
        phantom_domain_load_internal(domain['name']);
        // load details is manually called to get a result right away
        phantom_domain_details_internal();
        $("#phantom_domain_start_buttons").hide();
        $("#phantom_domain_running_buttons").show();
        $("#phantom_domain_list_domains").val(domain['name']);
        phantom_domain_buttons(true);
    }

    var error_func = function(obj, message) {
        phantom_alert(message);
        phantom_domain_buttons(true);
    }

    phantom_domain_buttons(false);
    var url = make_url('domains');
    phantomPOST(url, domain, success_func, error_func);
}

function phantom_domain_start_click() {
    try {
        phantom_domain_start_click_internal();
    }
    catch(err) {
        phantom_alert(err);
    }
}

function gather_domain_params_from_ui() {
    /* gather_domain_params_from_ui
     * get all of the domain parameters from the UI, validate them, then return
     * a formatted dictionary that can be used in a start or update call
     */
    var lc_name = $("#phantom_domain_lc_choice").val();
    var chef_server_name = null;
    if ( $("#phantom_domain_chef_choice").is(':visible')) {
        chef_server_name = $("#phantom_domain_chef_choice").val();
    }
    var lc_name = $("#phantom_domain_lc_choice").val();
    var domain_name = $("#phantom_domain_name_label").text();
    var de_name = g_decision_engines_by_name[$("#phantom_domain_de_choice").val()];
    var monitor_sensors_raw = $("input[name=hidden-tags]").val();

    var all_sensors = monitor_sensors_raw.split(",");
    var monitor_sensors_array = [];
    var monitor_domain_sensors_array = [];
    for (var i=0; i < all_sensors.length; i++) {
        var s = all_sensors[i];
        if (s.lastIndexOf("domain:", 0) === 0) {

            var s_cleaned = s.split("domain:")[1];
            monitor_domain_sensors_array.push(s_cleaned);
        }
        else {
            monitor_sensors_array.push(s);
        }
    }
    var monitor_sensors = monitor_sensors_array.join(",");
    var monitor_domain_sensors = monitor_domain_sensors_array.join(",");

    // Multicloud attrs
    var vm_count = $("#phantom_domain_size_input").val();

    // Sensor attrs
    var metric = $("#phantom_domain_metric_choice").val();
    var cooldown = $("#phantom_domain_cooldown_input").val();
    var minimum_vms = $("#phantom_domain_minimum_input").val();
    var maximum_vms = $("#phantom_domain_maximum_input").val();
    var scale_up_threshold = $("#phantom_domain_scale_up_threshold_input").val();
    var scale_up_vms = $("#phantom_domain_scale_up_n_vms_input").val();
    var scale_down_threshold = $("#phantom_domain_scale_down_threshold_input").val();
    var scale_down_vms = $("#phantom_domain_scale_down_n_vms_input").val();

    var error_msg = undefined;

    if (! lc_name) {
        error_msg = "You must select a launch configuration name";
    }
    if (! domain_name) {
        error_msg = "You must specify a domain name";
    }

    var data = {"name": domain_name, "lc_name": lc_name, "de_name": de_name,
        "monitor_sensors": monitor_sensors, "monitor_domain_sensors": monitor_domain_sensors};

    if (chef_server_name) {
        data['chef_credential'] = chef_server_name;
    }

    if (de_name == "multicloud") {
        if (! vm_count) {
            error_msg = "You must specify a number of vms to run";
        }

        data["vm_count"] = vm_count;
    }
    else if (de_name == "sensor") {
        if (! metric) {
            error_msg = "You must specify a metric";
        }
        if (! cooldown) {
            error_msg = "You must specify a cooldown";
        }
        if (! minimum_vms) {
            error_msg = "You must specify a minimum number of vms";
        }
        if (! maximum_vms) {
            error_msg = "You must specify a maximum number of vms";
        }
        if (! scale_up_threshold) {
            error_msg = "You must specify a scale up threshold";
        }
        if (! scale_up_vms) {
            error_msg = "You must specify a number of vms to scale up by";
        }
        if (! scale_down_threshold) {
            error_msg = "You must specify a scale down threshold";
        }
        if (! scale_down_vms) {
            error_msg = "You must specify a number of vms to scale down by";
        }

        data["sensor_metric"] = metric;
        data["sensor_cooldown"] = cooldown;
        data["sensor_minimum_vms"] = minimum_vms;
        data["sensor_maximum_vms"] = maximum_vms;
        data["sensor_scale_up_threshold"] = scale_up_threshold;
        data["sensor_scale_up_vms"] = scale_up_vms;
        data["sensor_scale_down_threshold"] = scale_down_threshold;
        data["sensor_scale_down_vms"] = scale_down_vms;
    }

    if (error_msg != undefined) {
        phantom_warning(error_msg);
        return null;
    }

    return data;
}

function phantom_domain_resize_click_internal() {

    var domain = gather_domain_params_from_ui();
    if (domain === null) {
        return;
    }
    var domain_id = g_domain_data[domain.name]['id'];

    var success_func = function(obj) {
        phantom_domain_buttons(true);
        phantom_domain_details_internal();
    }

    var error_func = function(obj, message) {
        phantom_alert(message);
        phantom_domain_buttons(true);
    }

    phantom_domain_buttons(false);
    var url = make_url('domains/' + domain_id);
    phantomPUT(url, domain, success_func, error_func);
}

function phantom_domain_resize_click() {
    try {
        phantom_domain_resize_click_internal();
    }
    catch(err) {
        phantom_alert(err);
    }
}

function phantom_domain_terminate_click_internal() {
    var domain_name = $("#phantom_domain_name_label").text();
    var domain_id = g_domain_data[domain_name]['id'];

    if(!domain_name) {
        phantom_warning("You must specify a domain name");
        return;
    }

    var success_func = function(obj) {
        delete g_domain_data[domain_name];
        delete g_domain_details_cache[domain_name];
        $("#phantom_domain_name_label").text("");
        $("#phantom_domain_lc_choice").val("");
        $("#phantom_domain_size_input").val("");
        $("#domain-" + domain_name).remove();
        phantom_domain_deselect_domain();
        phantom_domain_details_abort();
        phantom_domain_buttons(true);
    };

    var error_func = function(obj, message) {
        phantom_alert(message);
        phantom_domain_buttons(true);
    };

    phantom_domain_buttons(false);
    var url = make_url('domains/' + domain_id);
    phantomDELETE(url, success_func, error_func);
}

function phantom_domain_terminate_click() {
    try {
        phantom_domain_terminate_click_internal();
    }
    catch(err) {
        phantom_alert(err);
    }
}

function phantom_domain_select_domain_internal(domain_name, load_details) {

    g_selected_instance = null;
    phantom_domain_details_abort();
    if (!domain_name) {
        return;
    }

    phantom_domain_deselect_domain();
    phantom_domain_load_lc_names();
    phantom_domain_load_chef_names();
    phantom_domain_load_de_names();

    g_selected_domain = domain_name;
    $("a.domain").parent().removeClass("active");
    $("a.domain").filter(function() {return $(this).text() == domain_name}).parent().addClass("active");

    $("#phantom_domain_main_combined_pane_inner").show();
    $("#phantom_domain_instance_details").empty();

    var domain_data = g_domain_data[domain_name];
    $("#phantom_domain_name_label").text(domain_name);

    $("#details-nav a[href='#vm-details-tab']").tab("show");

    if (Object.keys(domain_data).length == 0) {
        phantom_select_de(DEFAULT_DECISION_ENGINE);
        $("#phantom_domain_start_buttons").show();
        $("#phantom_domain_running_buttons").hide();

        var lc_name = $("#phantom_domain_lc_choice").val();
        if (lc_name) {
            var lc = g_launch_configs[lc_name];
            if (lc && lc.contextualization_method == "chef") {
                $("#phantom_domain_chef_choice").parent().parent().show();
            }
            else {
                $("#phantom_domain_chef_choice").parent().parent().hide();
            }
        }
    }
    else {

        $("#phantom_domain_lc_choice").val(domain_data.lc_name);
        var lc = g_launch_configs[domain_data.lc_name];
        if (lc && lc.contextualization_method == "chef") {
            $("#phantom_domain_chef_choice").parent().parent().show();
            if (domain_data["chef_credential"]) {
                $("#phantom_domain_chef_choice").val(domain_data.chef_credential);
            }
        }
        else {
            $("#phantom_domain_chef_choice").parent().parent().hide();
        }


        $("#phantom_domain_start_buttons").hide();
        $("#phantom_domain_running_buttons").show();
        phantom_select_de(g_decision_engines_by_type[domain_data.de_name]);

        $("#phantom_domain_sensors_input").tagsManager('empty');
        var sensors = String(domain_data.monitor_sensors).split(",");
        for (var i=0; i<sensors.length; i++) {
            if (!sensors[i]) {
                continue;
            }
            $("#phantom_domain_sensors_input").tagsManager('pushTag', sensors[i]);
        }

        var domain_sensors = String(domain_data.monitor_domain_sensors).split(",");
        for (var i=0; i<domain_sensors.length; i++) {
            if (!domain_sensors[i]) {
                continue;
            }
            $("#phantom_domain_sensors_input").tagsManager('pushTag', "domain:" + domain_sensors[i]);
        }
 
        if (domain_data.de_name == "multicloud") {
            $("#phantom_domain_size_input").val(domain_data.vm_count);
        }
        else if (domain_data.de_name == "sensor") {
            //$("#phantom_domain_sensors_input").tagsManager('pushTag', domain_data.metric);
            $("#phantom_domain_metric_choice").val(domain_data.metric);
            $("#phantom_domain_cooldown_input").val(domain_data.sensor_cooldown);
            $("#phantom_domain_minimum_input").val(domain_data.sensor_minimum_vms);
            $("#phantom_domain_maximum_input").val(domain_data.sensor_maximum_vms);
            $("#phantom_domain_scale_up_threshold_input").val(domain_data.sensor_scale_up_threshold);
            $("#phantom_domain_scale_up_n_vms_input").val(domain_data.sensor_scale_up_vms);
            $("#phantom_domain_scale_down_threshold_input").val(domain_data.sensor_scale_down_threshold);
            $("#phantom_domain_scale_down_n_vms_input").val(domain_data.sensor_scale_down_vms);
        }
        if (load_details) {
            phantom_domain_details_internal();
        }
    }
}


function phantom_domain_select_domain(domain, load_details) {
    load_details = typeof load_details !== 'undefined' ? load_details : true;
    try {
        phantom_domain_select_domain_internal(domain, load_details);
    }
    catch(err) {
        phantom_alert(err);
    }
}

function phantom_domain_deselect_domain() {
    $("#phantom_domain_main_combined_pane_inner").show();
    $("#phantom_domain_instance_details").empty();
    $("#phantom_details_button_div").hide();
    $("#details_table_body").empty();
    $("#instance_table_body").empty();
    $("#scaling_sensor_value").hide();
    $("#scaling_table_body").empty();
    $("#domain_table_body").empty();
    $("#domain-metrics").hide();
    $("#phantom_domain_main_combined_pane_inner").hide();
    $("#phantom_domain_main_combined_pane_inner input[type='text']").val("");
    $("#phantom_domain_main_combined_pane_inner select").empty();
    $("#phantom_domain_sensors_input").tagsManager('empty');
}

function phantom_domain_update_click() {
    try {
        phantom_domain_details_internal();
    }
    catch(err) {
        phantom_alert(err);
    }
}

function phantom_domain_load_instances() {

    $("#phantom_domain_instance_details").empty();
    $("#instance_table_body").empty();

    var table_body = $("#details_table_body").empty();

    for(var i=0; i<g_domain_details.instances.length; i++) {
        var instance = g_domain_details.instances[i];

        var filter = $("#phantom_domain_filter_list").val();
        if (filter != "All VMs") {
            if(filter == "Healthy" &&
               (instance.lifecycle_state.indexOf("RUNNING") > 0 ||
                instance.lifecycle_state.indexOf("PENDING") > 0 ||
                instance.lifecycle_state.indexOf("REQUESTING") > 0)) {
            }
            else if (instance.lifecycle_state.indexOf(filter) < 0) {
                continue;
            }
        }
        
        var row = "<tr>" +
        "<td class='instance_id'>" + instance.iaas_instance_id + "</td>" +
        "<td><span class='label " +
        label_class_from_lifecycle_state(instance.lifecycle_state)
        + "'>" + human_lifecycle_state(instance.lifecycle_state) + "</td>"
        "</tr>";
        table_body.append(row);

    }
}

function label_class_from_lifecycle_state(state) {
    var state_code = state.split("-");
    var int_state_code = parseInt(state_code[0], 10);

    if (int_state_code < 600) {
        return "label-warning";
    }
    else if (int_state_code === 600) {
        return "label-success";
    }
    else if (int_state_code > 600) {
        return "label-important";
    }
    else {
        return "";
    }
}

function human_lifecycle_state(state) {
    var split_state = state.split("-");
    if (split_state.length !== 2) {
        return state;
    }
    else {
        return split_state[1];
    }
}

function get_selected_domain() {
    var domain = g_domain_data[g_selected_domain];
    return domain;
}

function get_selected_instance_id() {
    var instance_id = $("#details_table tr.info td.instance_id").text();
    return instance_id;
}

function get_instance(instance_id) {

    var instance = null;
    for(var i=0; i<g_domain_details.instances.length; i++) {
      
        var inst = g_domain_details.instances[i];
        if (inst.iaas_instance_id === instance_id) {
            instance = inst;
            break;
        }
    }
    return instance;
}

function show_domain_details(domain_id) {
    function make_row(key, value) {
      return "<tr><td><strong>" + key + ":</strong></td><td>" + value + "</td></tr>";
    }

    if (domain_id === null) {
        return;
    }

    var $table = $("#domain_table_body").empty();
    var domain = g_domain_details_cache[domain_id];
    if (domain === null) {
      return;
    }

    var data = "";
    var sensor_data = domain.domain_metrics;
    for (var metric in sensor_data) {
        for (var sensor_type in sensor_data[metric]) {
            if (sensor_type === "series") {
                // Ignore series data because it is ugly :)
                continue;
            }

            data += make_row(metric, sensor_data[metric][sensor_type]);
        }
    }
    $table.append(data);
    if ($table.children("tr").length === 0) {
        $("#domain-metrics").hide();
    }
    else {
        $("#domain-metrics").show();
    }

    var de_name = g_decision_engines_by_name[$("#phantom_domain_de_choice").val()];
    if (de_name === "sensor") {

        var scaling_metric = g_domain_data[domain_id]['metric'];
        var domain_metrics = domain.domain_metrics;
        var sensor_data = null;
        if (domain.domain_metrics && scaling_metric in domain.domain_metrics) {
            sensor_data = domain.domain_metrics[scaling_metric]['Average'];
        }
        else {
            var instance_metrics = [];
            for (var i=0; i<domain.instances.length; i++) {
                var instance = domain.instances[i];
                if (instance.sensor_data && scaling_metric in instance.sensor_data) {
                    instance_metrics.push(instance.sensor_data[scaling_metric]['Average']);
                }
            }
            if (instance_metrics.length > 0){
                var sum = 0;
                for (var j=0; j<instance_metrics.length; j++) {
                    sum += parseFloat(instance_metrics[j]);
                }
                sensor_data = sum/instance_metrics.length;
            }

        }

        if (sensor_data !== null) {
            $("#scaling_sensor_value").show();
            var row = make_row(scaling_metric, sensor_data);
            $("#scaling_table_body").empty().append(row);
        }
    }
}


function show_instance_details(instance_id) {
    function make_row(key, value) {
      return "<tr><td><strong>" + key + ":</strong></td><td>" + value + "</td></tr>";
    }

    if (instance_id === null) {
        return;
    }

    $("#details_table_body").children().removeClass("info");
    var matched_row = $("#details_table_body tr td:contains('" + instance_id + "')")
      .parent().addClass("info");

    // If this instance isn't shown right now, we don't want to display it.
    // This could happen when instances are filtered
    if (matched_row.length === 0) {
        return;
    }

    var table = $("#instance_table_body").empty();
    var instance = get_instance(instance_id)
    if (instance === null) {
      return;
    }

    $("#phantom_details_button_div").show();

    g_selected_instance = instance_id;

    // API returns a url, rather than a cloud name
    var instance_cloud = instance.cloud.split("/").pop();

    var data = make_row("Instance ID", instance.iaas_instance_id) +
    make_row("Hostname", instance.hostname) +
    make_row("Public IP", instance.public_ip) +
    make_row("Private IP", instance.private_ip) +
    make_row("State", instance.lifecycle_state) +
    make_row("Cloud", instance_cloud) +
    make_row("Image", instance.image_id) +
    make_row("Instance Type", instance.instance_type) +
    make_row("SSH Key", instance.keyname);

    var sensor_data = instance.sensor_data;
    for (var metric in sensor_data) {
        for (var sensor_type in sensor_data[metric]) {
            if (sensor_type === "series" || sensor_type === "Series") {
                // Ignore series data because it is ugly :)
                continue;
            }

            data += make_row(metric, sensor_data[metric][sensor_type]);
        }
    }

    table.append(data);
}

function phantom_domain_details_internal() {

    phantom_domain_details_abort();
    phantom_domain_details_buttons(false);

    var domain_name = $("#phantom_domain_name_label").text();
    if (!domain_name || ! g_domain_data[domain_name]) {
        return;
    }

    var domain_id = g_domain_data[domain_name]['id'];
    if (!domain_id) {
        return;
    }

    if (domain_name in g_domain_details_cache) {
        g_domain_details = g_domain_details_cache[domain_name];
        phantom_domain_load_instances();
        show_instance_details(g_selected_instance);
        show_domain_details(domain_name);
    }

    var data = {'name': domain_name};

    var success_func = function(instances) {
        g_current_details_request = null;
        $("#phantom_domain_instance_details").empty();

        g_domain_details = {
            'instances': instances
        }
        g_domain_details_cache[domain_name] = g_domain_details;

        phantom_domain_load_instances();
        phantom_domain_buttons(true);
        phantom_domain_details_buttons(true);
        show_instance_details(g_selected_instance);
        show_domain_details(domain_name);
        phantom_start_details_timer();
    }

    var error_func = function(obj, message) {
        g_current_details_request = null;
        phantom_domain_buttons(true);
        phantom_domain_details_buttons(true);
    }

    var url = make_url("domains/" + domain_id + "/instances");
    g_current_details_request =  phantomGET(url, success_func, error_func);
}

function phantom_start_details_timer() {
    g_current_details_timer = window.setTimeout(phantom_domain_details_internal, DETAILS_TIMER_MS);
}

function phantom_domain_details_abort() {

    if (g_current_details_request !== null) {
        try {
            g_current_details_request.abort();
        }
        catch (e) {
        }
        g_current_details_request = null;
    }
    if (g_current_details_timer !== null) {
        window.clearInterval(g_current_details_timer);
        g_current_details_timer = null;
    }
    phantom_domain_details_buttons(true);
}


function phantom_domain_context_menu(e, domain_id, instance_id, cloud) {
    var obj = $("#phantom_domain_instance_context_menu");
    var terminate = $("#context_terminate");
    var replace = $("#context_replace");

    var o = {
        position: "absolute",
        left: e.pageX,
        top: e.pageY,
    };

    function nestedterminateClick() {
        try{
            phantom_domain_instance_terminate_click(domain_id, instance_id, cloud);
        }
        catch(err) {
            phantom_alert(err);
        }
    }
    terminate.unbind("click");
    terminate.click(nestedterminateClick);

    function nestedReplaceClick() {
        try{
            phantom_domain_instance_replace_click(domain_id, instance_id, cloud);
        }
        catch(err) {
            phantom_alert(err);
        }
    }
    replace.unbind("click");
    replace.click(nestedReplaceClick);

    e.stopPropagation();
    obj.css(o);
    obj.show();
    obj.css('zIndex', 2000);
}

function phantom_domain_instance_terminate_click(domainid, instanceid, cloudname) {

    var obj = $("#phantom_domain_instance_context_menu");
    var msg = "Do you want to kill the VM instance ".concat(instanceid).concat("?");
    var answer = confirm(msg);

    if (!answer) {
        return;
    }

    var success_func = function(obj){
        phantom_domain_details_internal();
    }

    var error_func = function(obj, message) {
        phantom_alert(message);
        phantom_domain_buttons(true);
    }

    phantom_domain_buttons(false);
    var url = make_url("domains/" + domainid + "/instances/" + instanceid + "?adjust_policy=true");
    phantomDELETE(url, success_func, error_func);
}

function phantom_domain_instance_replace_click(domainid, instanceid, cloudname) {

    var obj = $("#phantom_domain_instance_context_menu");
    var msg = "Do you want to kill and replace the VM instance ".concat(instanceid).concat("?");
    var answer = confirm(msg);

    if (!answer) {
        return;
    }

    var success_func = function(obj){
        phantom_domain_details_internal();
    }

    var error_func = function(obj, message) {
        phantom_alert(message);
        phantom_domain_buttons(true);
    }

    phantom_domain_buttons(false);
    var url = make_url("domains/" + domainid + "/instances/" + instanceid);
    phantomDELETE(url, success_func, error_func);
}

function phantom_domain_noncontext_mouse_down() {
    var obj = $("#phantom_domain_instance_context_menu");
    if (obj.is(':visible') ) {
        obj.hide();
    }
}
