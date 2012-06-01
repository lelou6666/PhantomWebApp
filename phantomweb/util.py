from boto.exception import BotoServerError
from django.template import Context, loader
from django.http import HttpResponse
import logging
from phantomweb.models import UserPhantomInfoDB, UserCloudInfoDB
from phantomweb.phantom_web_exceptions import PhantomWebException
from phantomsql import PhantomSQL
from phantomweb.models import PhantomInfoDB, DefaultCloudsDB

def get_key_name():
    return "nimbusphantom"

g_general_log = logging.getLogger('phantomweb.general')


def LogEntryDecorator(func):
    def wrapped(*args, **kw):
        try:
            g_general_log.debug("Entering %s." % (func.func_name))
            return func(*args, **kw)
        except Exception, ex:
            g_general_log.exception("exiting %s with error: %s." % (func.func_name, str(ex)))
            raise
        finally:
            g_general_log.debug("Exiting %s." % (func.func_name))
    return wrapped

def PhantomWebDecorator(func):

    def wrapped(*args, **kw):
        try:
            response_dict = func(*args,**kw)
        except PhantomWebException, pex:
            g_general_log.exception("Phantom Error %s" % (pex.message))
            response_dict = {
                'error_message': pex.message,
            }
        except BotoServerError, bex:
            g_general_log.exception("Boto Error %s : %s" % (bex.reason, bex.body))
            response_dict = {
                'error_message': "Error communiting with the cloud service: %s" % (bex.reason),
            }
        g_general_log.debug("returning response_dict %s" % (str(response_dict)))
        return response_dict
    return wrapped


def render_template(fname, d):
    t = loader.get_template(full_path)
    c = Context(response_dict)
    return HttpResponse(t.render(c))

def get_cloud_objects(username):
    clouds = UserCloudInfoDB.objects.filter(username=username)
    return clouds

def get_user_object(username):
    phantom_l = UserPhantomInfoDB.objects.filter(username=username)
    if not phantom_l:
        return None
    if len(phantom_l) > 1:
        raise PhantomWebException("There are multiple users by the name %s.  The admin must clean this." % (username))
    return phantom_l[0]


class UserCloudInfo(object):

    def __init__(self, cloudname, username, iaas_key, iaas_secret, cloud_url):
        self.cloudname = cloudname
        self.username = username
        self.iaas_key = iaas_key
        self.iaas_secret = iaas_secret
        self.cloud_url = cloud_url

class UserObject(object):
    pass

class UserObjectDJangoDB(UserObject):

    def __init__(self, username):
        self.username = username
        self.phantom_data = get_user_object(username)
        # add the user if they do not exist in the DB
        if not self.phantom_data:
            self.phantom_data = UserPhantomInfoDB()
            self.phantom_data.username = username
            self.phantom_data.phantom_key = ""
            self.phantom_data.phantom_secret = ""
            self.phantom_data.phantom_url = ""
            self.phantom_data.save()

        self.phantom_key = None
        self.phantom_secret = None
        self._load_clouds()

    def has_phantom_data(self):
       return (self.phantom_data and self.phantom_data.phantom_key and self.phantom_data.phantom_secret and self.phantom_data.phantom_url)

    def _load_clouds(self):
        clouds = get_cloud_objects(self.username)
        self.iaasclouds = {}
        for c in clouds:
            self.iaasclouds[c.cloudname] = c

    def get_cloud(self, name):
        if name not in self.iaasclouds:
            raise PhantomWebException("No cloud named %s associated with the user" % (name))
        return self.iaasclouds[name]

    def persist(self):
        self.phantom_data.save()

    def change_cloud(self, name, url, key, secret):
        if name not in self.iaasclouds:
            raise PhantomWebException("%s is not a known cloud for user %s" % (name, self.username))
        c = self.iaasclouds[name]
        self._change_cloud(c, name, url, key, secret)

    def change_or_add(self, name, url, key, secret):
        if name not in self.iaasclouds:
            cloud_info = UserCloudInfoDB()
        else:
            cloud_info = self.iaasclouds[name]
        self._change_cloud(cloud_info, name, url, key, secret)

    def _change_cloud(self, cloud_info, name, url, key, secret):
        cloud_info.cloudname = name
        cloud_info.username = self.username
        cloud_info.iaas_key = key
        cloud_info.iaas_secret = secret
        cloud_info.cloud_url = url
        cloud_info.save()

    def add_cloud(self, name, url, key, secret):
        cloud_info = UserCloudInfoDB()
        self._change_cloud(name, url, key, secret)
        self.iaasclouds[cloud_info.cloudname] = cloud_info


class UserObjectMySQL(UserObject):

    def __init__(self, username):

        phantom_info_objects = PhantomInfoDB.objects.all()
        if not phantom_info_objects:
            raise PhantomWebException('The service is mis-configured.  Please contact your sysadmin')

        self.phantom_info = phantom_info_objects[0]
        g_general_log.debug("Usign dburl %s" % (self.phantom_info.dburl))
        self._authz = PhantomSQL(self.phantom_info.dburl)
        self._user_dbobject = self._authz.get_user_object_by_display_name(username)
        if not self._user_dbobject:
            raise PhantomWebException('The user %s is not associated with cloud user database.  Please contact your sysadmin' % (username))
        self._load_clouds()

    def has_phantom_data(self):
       return True

    def _load_clouds(self):
        clouds = DefaultCloudsDB.objects.all()
        self.iaasclouds = {}
        for c in clouds:
            uci = UserCloudInfo(c.name, self._user_dbobject.displayname, self._user_dbobject.access_key, self._user_dbobject.access_secret, c.url)
            self.iaasclouds[c.name] = uci

    def get_cloud(self, name):
        if name not in self.iaasclouds:
            raise PhantomWebException("No cloud named %s associated with the user" % (name))
        return self.iaasclouds[name]


def get_user_object(username):
    return UserObjectMySQL(username)
