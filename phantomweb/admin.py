from django.contrib import admin

from phantomweb.models import RabbitInfoDB, LaunchConfigurationDB,\
    HostMaxPairDB, PhantomUser, LaunchConfiguration, PublicLaunchConfiguration, \
    ImageGenerator, ImageGeneratorScript, ImageGeneratorCloudConfig, ImageBuild, \
    PackerCredential, ImageBuildArtifact


class RabbitInfoAdmin(admin.ModelAdmin):
    pass

admin.site.register(RabbitInfoDB, RabbitInfoAdmin)


class AutoScaleLaunchConfigurationAdmin(admin.ModelAdmin):
    pass

admin.site.register(LaunchConfigurationDB, AutoScaleLaunchConfigurationAdmin)


class LaunchConfigurationAdmin(admin.ModelAdmin):
    pass

admin.site.register(LaunchConfiguration, LaunchConfigurationAdmin)


class PublicLaunchConfigurationAdmin(admin.ModelAdmin):
    pass

admin.site.register(PublicLaunchConfiguration, LaunchConfigurationAdmin)


class HostMaxPairAdmin(admin.ModelAdmin):
    pass

admin.site.register(HostMaxPairDB, HostMaxPairAdmin)


class PhantomUserAdmin(admin.ModelAdmin):
    pass

admin.site.register(PhantomUser, PhantomUserAdmin)


class PackerCredentialAdmin(admin.ModelAdmin):
    pass

admin.site.register(PackerCredential, PackerCredentialAdmin)


class ImageGeneratorAdmin(admin.ModelAdmin):
    pass

admin.site.register(ImageGenerator, ImageGeneratorAdmin)


class ImageGeneratorScriptAdmin(admin.ModelAdmin):
    pass

admin.site.register(ImageGeneratorScript, ImageGeneratorScriptAdmin)


class ImageGeneratorCloudConfigAdmin(admin.ModelAdmin):
    pass

admin.site.register(ImageGeneratorCloudConfig, ImageGeneratorCloudConfigAdmin)


class ImageBuildAdmin(admin.ModelAdmin):
    pass

admin.site.register(ImageBuild, ImageBuildAdmin)


class ImageBuildArtifactAdmin(admin.ModelAdmin):
    pass

admin.site.register(ImageBuildArtifact, ImageBuildArtifactAdmin)
