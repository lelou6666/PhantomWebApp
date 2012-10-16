import boto
from boto.ec2.connection import EC2Connection
from boto.regioninfo import RegionInfo
import logging
import urlparse
import boto.ec2.autoscale
from phantomweb.models import LaunchConfigurationDB, HostMaxPairDB
from phantomweb.phantom_web_exceptions import PhantomWebException
from phantomweb.util import PhantomWebDecorator, LogEntryDecorator
from phantomsql import phantom_get_default_key_name

import logging   # import the required logging module

g_general_log = logging.getLogger('phantomweb.general')

# at some point this should come from some sort of DB
g_instance_types = ["m1.small", "m1.large", "m1.xlarge"]

@LogEntryDecorator
def _get_phantom_con(userobj):
    url = userobj.phantom_info.phantom_url
    g_general_log.debug("Getting phantom can at %s" % (url))

    uparts = urlparse.urlparse(url)
    is_secure = uparts.scheme == 'https'
    region = RegionInfo(endpoint=uparts.hostname)
    con = boto.ec2.autoscale.AutoScaleConnection(aws_access_key_id=userobj._user_dbobject.access_key, aws_secret_access_key=userobj._user_dbobject.access_secret, is_secure=is_secure, port=uparts.port, region=region, validate_certs=False)
    con.host = uparts.hostname
    return con

@LogEntryDecorator
def _get_keys(ec2conn):
    r = ec2conn.get_all_key_pairs()
    rs = [k.name for k in r]
    return rs

@PhantomWebDecorator
@LogEntryDecorator
def get_iaas_info(request_params, userobj):

    params = ['cloud',]
    for p in params:
        if p not in request_params:
            raise PhantomWebException('Missing parameter %s' % (p))

    cloud_name = request_params['cloud']
    iaas_cloud = userobj.get_cloud(cloud_name)

    ec2conn = iaas_cloud.get_iaas_compute_con()
    g_general_log.debug("Looking up images for user %s on %s" % (userobj._user_dbobject.access_key, cloud_name))
    l = ec2conn.get_all_images()
    common_images = [c.id for c in l if c.is_public]
    user_images = [u.id for u in l if not u.is_public]

    response_dict = {
        'name': 'hello',
        'user_images': user_images,
        'common_images': common_images,
    }
    return response_dict

@PhantomWebDecorator
@LogEntryDecorator
def list_domains(request_params, userobj):
    con = _get_phantom_con(userobj)

    domain_names = None
    if 'domain_name' in request_params:
        domain_name = request_params['domain_name']
        domain_names = [domain_name,]
    g_general_log.debug("Looking up domain names %s for user %s" % (str(domain_names), userobj._user_dbobject.access_key))

    asgs = con.get_all_groups(names=domain_names)
    return_asgs = []

    for a in asgs:
        ent = {}
        ent['name'] = a.name
        ent['desired_capacity'] = a.desired_capacity
        lc_name = a.launch_config_name
        lcs = con.get_all_launch_configurations(names=[lc_name,])
        ent['cloudname'] = a.availability_zones[0]
        if lcs:
            lc = lcs[0]
            ent['lc_name'] = lc.name
            ent['image_id'] = lc.image_id
            ent['key_name'] = lc.key_name
            ent['instance_type'] = lc.instance_type
        inst_list = []
        for instance in a.instances:
            i_d = {}
            i_d['cloud'] = instance.availability_zone
            i_d['health_status'] = instance.health_status
            i_d['instance_id'] = instance.instance_id.strip()
            i_d['lifecycle_state'] = instance.lifecycle_state
            inst_list.append(i_d)
            i_d['hostname'] = "unknown"

            if i_d['instance_id']:
                # look up more info with boto.  this could be optimized for network communication
                iaas_cloud = userobj.get_cloud(i_d['cloud'])
                iaas_con = iaas_cloud.get_iaas_compute_con()
                boto_insts = iaas_con.get_all_instances(instance_ids=[i_d['instance_id'],])
                if boto_insts and boto_insts[0].instances:
                    boto_i = boto_insts[0].instances[0]
                    i_d['hostname'] = boto_i.dns_name

        ent['instances'] = inst_list

        return_asgs.append(ent)

    response_dict = {
        'name': 'hello',
        'domains': return_asgs,
    }
    return response_dict


@LogEntryDecorator
def _find_or_create_config(con, size, image_id, keyname, common, lc_name):
    lcs = con.get_all_launch_configurations(names=[lc_name,])
    if not lcs:
        lc = boto.ec2.autoscale.launchconfig.LaunchConfiguration(con, name=lc_name, image_id=image_d, key_name=keyname, security_groups='default', instance_type=size)
        con.create_launch_configuration(lc)
        return lc
    return lcs[0]   


@PhantomWebDecorator
@LogEntryDecorator
def start_domain(request_params, userobj):
    con = _get_phantom_con(userobj)

    params = ['size', 'name', 'image', 'cloud', 'common', 'desired_size']
    for p in params:
        if p not in request_params:
            raise PhantomWebException('Missing parameter %s' % (p))

    image_name = request_params['image']
    size = request_params['size']
    asg_name = request_params['name']
    cloud = request_params['cloud']
    common = request_params['common']

    try:
        desired_size = int(request_params['desired_size'])
    except:
        e_msg = 'Please set the desired size to an integer, not %s' % (str(request_params['desired_size']))
        g_general_log.error(e_msg)
        raise PhantomWebException(e_msg)

    lc_name = "WEB-%s-%s-%s" % (size, image_name, common)
    key_name = phantom_get_default_key_name()

    g_general_log.debug("starting to launch: %s %s %s %s %d" % (image_name, str(size), asg_name, cloud, desired_size))

    iaas_cloud = userobj.get_cloud(cloud)
    ec2con = iaas_cloud.get_iaas_compute_con()
    kps = _get_keys(ec2con)
    if key_name not in kps:
        e_msg = "The key name %s is not known.  Please provide a public key in the settings section." % (key_name)
        g_general_log.error(e_msg)
        raise PhantomWebException(e_msg)

    lc_name = "%s@%s" % (lc_name, cloud)
    lc = _find_or_create_config(con, size, image_name, key_name, common, lc_name)
    asg = boto.ec2.autoscale.group.AutoScalingGroup(launch_config=lc, connection=con, group_name=asg_name, availability_zones=[cloud], min_size=desired_size, max_size=desired_size)
    con.create_auto_scaling_group(asg)
    response_dict = {
        'Success': True,
    }
    return response_dict

@PhantomWebDecorator
@LogEntryDecorator
def delete_domain(request_params, userobj):
    con = _get_phantom_con(userobj)

    params = ['name']
    for p in params:
        if p not in request_params:
            return None

    asg_name = request_params['name']
    g_general_log.debug("deleting %s" % (asg_name))
    con.delete_auto_scaling_group(asg_name)
    response_dict = {
        'Success': True,
    }
    return response_dict


@PhantomWebDecorator
@LogEntryDecorator
def update_desired_size(request_params, userobj):
    con = _get_phantom_con(userobj)

    params = ['name', 'new_desired_size']
    for p in params:
        if p not in request_params:
            return None
    asg_name = request_params['name']

    try:
        asg_new_desired_size = int(request_params['new_desired_size'])
    except:
        e_msg = 'Please set the desired size to an integer, not %s' % (str(request_params['new_desired_size']))
        g_general_log.error(e_msg)
        raise PhantomWebException(e_msg)

    g_general_log.debug("updating %s to be size %d" % (asg_name, asg_new_desired_size))

    asgs = con.get_all_groups(names=[asg_name,])
    if not asgs:
        e_msg = "The domain %s does not exist." % (asg_name)
        raise PhantomWebException(e_msg)
    asgs[0].set_capacity(asg_new_desired_size)

    response_dict = {
        'Success': True,
    }
    return response_dict


@PhantomWebDecorator
@LogEntryDecorator
def phantom_main_html(request_params, userobj):
    global g_instance_types
    cloud_locations = userobj.iaasclouds.keys()
    response_dict = {
        'instance_types': g_instance_types,
        'cloud_locations': cloud_locations,
    }
    return response_dict


@PhantomWebDecorator
@LogEntryDecorator
def terminate_iaas_instance(request_params, userobj):

    params = ['cloud','instance']
    for p in params:
        if p not in request_params:
            raise PhantomWebException('Missing parameter %s' % (p))

    cloud_name = request_params['cloud']
    iaas_cloud = userobj.get_cloud(cloud_name)
    instance = request_params['instance']

    ec2conn = iaas_cloud.get_iaas_compute_con()
    g_general_log.debug("User %s terminating the instance %s on %s" % (userobj._user_dbobject.access_key, instance, cloud_name))
    ec2conn.terminate_instances(instance_ids=[instance,])

    response_dict = {
        'name': 'terminating',
        'success': 'success',
        'instance': instance,
        'cloud': cloud_name
    }
    return response_dict

#
#  cloud site management pages
#
@PhantomWebDecorator
@LogEntryDecorator
def phantom_sites_delete(request_params, userobj):
    params = ['cloud',]
    for p in params:
        if p not in request_params:
            raise PhantomWebException('Missing parameter %s' % (p))

    site_name = request_params['cloud']

    userobj.delete_site(site_name)
    userobj._load_clouds()
    response_dict = {
    }
    return response_dict


@PhantomWebDecorator
@LogEntryDecorator
def phantom_sites_add(request_params, userobj):
    params = ['cloud', "access", "secret", "keyname"]
    for p in params:
        if p not in request_params:
            raise PhantomWebException('Missing parameter %s' % (p))

    site_name = request_params['cloud']
    keyname = request_params['keyname']
    access = request_params['access']
    secret = request_params['secret']

    userobj.add_site(site_name, access, secret, keyname)
    response_dict = {
    }
    return response_dict


@PhantomWebDecorator
@LogEntryDecorator
def phantom_sites_load(request_params, userobj):
    sites = userobj.get_clouds()
    all_sites = userobj.get_possible_sites()

    out_info = {}
    for site_name in sites:
        ci = sites[site_name]
        ci_dict = {
            'username': ci.username,
            'access_key': ci.iaas_key,
            'secret_key': ci.iaas_secret,
            'keyname': ci.keyname,
            'status': 0,
            'status_msg': ""
        }

        ec2conn = ci.get_iaas_compute_con()
        try:
            keypairs = ec2conn.get_all_key_pairs()
            keyname_list = [k.name for k in keypairs]
            ci_dict['keyname_list'] = keyname_list
            ci_dict['status_msg'] = ""
        except Exception, boto_ex:
            g_general_log.error("Error connecting to the service %s" % (str(boto_ex)))
            ci_dict['keyname_list'] = []
            ci_dict['status_msg'] = "Error communication with the specific cloud %s.  Please check your credentials." % (site_name)
            ci_dict['status'] = 1

        out_info[site_name] = ci_dict

    response_dict = {
        'sites': out_info,
        'all_sites': all_sites
    }
    return response_dict

def _parse_param_name(needle, haystack, request_params, lc_dict):
    ndx = haystack.find("." + needle)
    if ndx < 0:
        return lc_dict
    site_name = haystack[:ndx]
    val = request_params[haystack]

    if site_name in lc_dict:
        entry = lc_dict[site_name]
    else:
        entry = {}
    entry[needle] = val
    lc_dict[site_name] = entry

    return lc_dict

#
#  cloud launch config functions
#
@PhantomWebDecorator
@LogEntryDecorator
def phantom_lc_load(request_params, userobj):
    global g_instance_types

    clouds_d = userobj.get_clouds()

    phantom_con = _get_phantom_con(userobj)
    try:
        lcs = phantom_con.get_all_launch_configurations()
    except Exception, ex:
        raise PhantomWebException("Error communication with Phantom REST: %s" % (str(ex)))

    all_lc_dict = {}
    rank_ctr = 1
    for lc in lcs:
        ndx = lc.name.find("@")
        if ndx < 0:
            g_general_log.error("Invalid LC name %s" % (lc.name))
        lc_name = lc.name[:ndx]
        site_name = lc.name[ndx+1:]

        lc_db_object = LaunchConfigurationDB.objects.filter(name=lc_name)
        if not lc_db_object or len(lc_db_object) < 1:
            g_general_log.info("No local information for %s, must have been configured outside of the web app" % (lc_name))
            lc_db_object = LaunchConfigurationDB.objects.create(name=lc_name)
        else:
            lc_db_object = lc_db_object[0]
        host_vm_db = HostMaxPairDB.objects.filter(cloud_name=site_name, launch_config=lc_db_object)
        if not host_vm_db:
            g_general_log.info("No local information for the host %s on lc %s must have been configured outside of the web app" % (site_name, lc_name))
            rank = rank_ctr
            max_vms = -1
        else:
            rank = host_vm_db[0].rank
            max_vm = host_vm_db[0].max_vms
        site_entry = {
            'cloud': site_name,
            'image_id': lc.image_id,
            'instance_type': lc.instance_type,
            'keyname': lc.key_name,
            'user_data': lc.user_data,
            'common': True,
            'max_vm': max_vm,
            'rank': rank
        }
        lc_dict = {}
        if lc_name in all_lc_dict:
            lc_dict = all_lc_dict[lc_name]

        lc_dict[site_name] = site_entry
        all_lc_dict[lc_name] = lc_dict

        rank_ctr = rank_ctr + 1

    iaas_info = {}
    for cloud_name in clouds_d:
        try:
            cloud_info = {}
            cloud = clouds_d[cloud_name]
            ec2conn = cloud.get_iaas_compute_con()
            g_general_log.debug("Looking up images for user %s on %s" % (userobj._user_dbobject.access_key, cloud_name))
            l = ec2conn.get_all_images()
            common_images = [c.id for c in l if c.is_public]
            user_images = [u.id for u in l if not u.is_public]
            keypairs = ec2conn.get_all_key_pairs()
            keynames = [k.name for k in keypairs]
            cloud_info['public_images'] = common_images
            cloud_info['personal_images'] = user_images
            cloud_info['keynames'] = keynames
            cloud_info['instances'] = g_instance_types
            cloud_info['status'] = 0
        except Exception, ex:
            g_general_log.warn("Error communication with %s for user %s | %s" % (cloud_name, userobj._user_dbobject.access_key, str(ex)))
            cloud_info = {'error': str(ex)}
            cloud_info['status'] = 1
        iaas_info[cloud_name] = cloud_info

        response_dict = {
        'cloud_info': iaas_info,
        'lc_info': all_lc_dict
    }
    return response_dict


@PhantomWebDecorator
@LogEntryDecorator
def phantom_lc_save(request_params, userobj):
    lc_name = request_params['name']

    lc_dict = {}
    # we need to convert params to a usable dict
    for param_name in request_params:
        _parse_param_name("cloud", param_name, request_params, lc_dict)
        _parse_param_name("keyname", param_name, request_params, lc_dict)
        _parse_param_name("image_id", param_name, request_params, lc_dict)
        _parse_param_name("instance_type", param_name, request_params, lc_dict)
        _parse_param_name("max_vm", param_name, request_params, lc_dict)
        _parse_param_name("common", param_name, request_params, lc_dict)
        _parse_param_name("rank", param_name, request_params, lc_dict)

    lc_db_object = LaunchConfigurationDB.objects.filter(name=lc_name)
    if not lc_db_object:
        lc_db_object = LaunchConfigurationDB.objects.create(name=lc_name)
    else:
        lc_db_object = lc_db_object[0]
    lc_db_object.save()

    phantom_con = _get_phantom_con(userobj)

    # manually unrolling due to need to interact with REST API
    successfully_added = []
    success_host_db_list = []
    try:
        for site_name in lc_dict:
            lc_conf_name = "%s@%s" % (lc_name, site_name)
            entry = lc_dict[site_name]

            try:
                # we probably need to list everything with the base name and delete it
                phantom_con.delete_launch_configuration(lc_conf_name)
            except Exception, boto_del_ex:
                # delete in case this is an update
                pass
            lc = boto.ec2.autoscale.launchconfig.LaunchConfiguration(phantom_con, name=lc_conf_name, image_id=entry['image_id'], key_name=entry['keyname'], security_groups=['default'], instance_type=entry['instance_type'])
            phantom_con.create_launch_configuration(lc)
            successfully_added.append(lc_conf_name)

            host_max_db = HostMaxPairDB.objects.create(cloud_name=site_name, max_vms=entry['max_vm'], launch_config=lc_db_object, rank=int(entry['rank']))
            success_host_db_list.append(host_max_db)
            host_max_db.save()
    except Exception, boto_ex:
        g_general_log.error("Error adding the launch configuration %s | %s" % (lc_name, str(boto_ex)))
        for host_max_db in success_host_db_list:
            host_max_db.delete()
        for lc_conf_name in successfully_added:
            phantom_con.delete_launch_configuration(lc_conf_name)
        lc_db_object.delete()
        raise

    response_dict = {}
    
    return response_dict

@PhantomWebDecorator
@LogEntryDecorator
def phantom_lc_delete(request_params, userobj):
    params = ["name",]
    for p in params:
        if p not in request_params:
            raise PhantomWebException('Missing parameter %s' % (p))

    lc_name = request_params['name']

    phantom_con = _get_phantom_con(userobj)
    try:
        lcs = phantom_con.get_all_launch_configurations()
    except Exception, ex:
        raise PhantomWebException("Error communication with Phantom REST: %s" % (str(ex)))


    lc_db_object = LaunchConfigurationDB.objects.filter(name=lc_name)
    if not lc_db_object or len(lc_db_object) < 1:
        raise PhantomWebException("No such launch configuration %s. Misconfigured service" % (lc.name))
    lc_db_object = lc_db_object[0]
    host_vm_db_a = HostMaxPairDB.objects.filter(launch_config=lc_db_object)
    if not host_vm_db_a:
        raise PhantomWebException("No such launch configuration %s. Misconfigured service" % (lc_name))

    for lc in lcs:
        ndx = lc.name.find(lc_name)
        if ndx == 0:
            lc.delete()
    for host_vm_db in host_vm_db_a:
        host_vm_db.delete()
    lc_db_object.delete()

    response_dict = {}

    return response_dict
